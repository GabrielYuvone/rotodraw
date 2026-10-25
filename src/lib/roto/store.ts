// ============================================================
// VectorRot-Local — Zustand Store
// Central project state, layers, frames, keyframes, brushes, onion skin
// ============================================================

import { create } from "zustand";
import type {
  BrushConfig,
  Frame,
  Layer,
  OnionSkinConfig,
  RotoProject,
  ResolutionConfig,
  SubLayer,
  ToolMode,
  Vec2,
  VectorShape,
  WorkingFPS,
} from "./types";
import {
  booleanSubtract,
  booleanUnion,
  interpolateShapes,
  multiPolygonToShapes,
  resampleWithinRadius,
  shapeToRing,
  strokeToPolygon,
  uid,
} from "./geometry";
import {
  computeOpticalFlow,
  extractGrayscaleFrame,
  propagatePointsByFlow,
  seekVideoAndWait,
} from "./opticalFlow";

// -------- Default starter project (demo "Remera" + "Cara") --------

function makeDefaultLayers(): Layer[] {
  const remeraSubs: SubLayer[] = [
    {
      id: uid("sub"),
      name: "Contorno",
      visible: true,
      locked: false,
      kind: "outline",
      shapes: [],
    },
    {
      id: uid("sub"),
      name: "Pleno Azul",
      visible: true,
      locked: false,
      kind: "fill",
      shapes: [],
    },
    {
      id: uid("sub"),
      name: "Sombra Oscura",
      visible: true,
      locked: false,
      kind: "shadow",
      shapes: [],
    },
    {
      id: uid("sub"),
      name: "Detalle Claro",
      visible: true,
      locked: false,
      kind: "highlight",
      shapes: [],
    },
  ];

  const caraSubs: SubLayer[] = [
    {
      id: uid("sub"),
      name: "Contorno Rostro",
      visible: true,
      locked: false,
      kind: "outline",
      shapes: [],
    },
    {
      id: uid("sub"),
      name: "Pleno Piel",
      visible: true,
      locked: false,
      kind: "fill",
      shapes: [],
    },
  ];

  return [
    {
      id: uid("layer"),
      name: "Remera",
      visible: true,
      locked: false,
      subLayers: remeraSubs,
      color: "#3b6fb5",
    },
    {
      id: uid("layer"),
      name: "Cara",
      visible: true,
      locked: false,
      subLayers: caraSubs,
      color: "#e8b87a",
    },
  ];
}

function makeDefaultBrush(): BrushConfig {
  return {
    mode: "draw",
    deformRadius: 80,
    deformStrength: 0.4,
    deformScope: "local",
    drawStrokeWidth: 3,
    drawStrokeEnabled: true,
    drawFillEnabled: true,
    drawStrokeJitter: 0.4,
    drawStrokeVariance: 0.2,
    drawSmoothing: 2,
    fillColor: "#3b6fb5",
    autoClose: true,
    blobBrushRadius: 18,
    blobSmoothing: 2,
    knifeAutoClose: true,
    nodeSnapRadius: 12,
    relaxRadius: 60,
    relaxSpacing: 0.4,
  };
}

function makeDefaultOnion(): OnionSkinConfig {
  return {
    enabled: true,
    previousFrames: 2,
    nextFrames: 2,
    opacityStep: 0.25,
  };
}

interface RotoState {
  // Project meta
  project: RotoProject;
  brush: BrushConfig;
  onion: OnionSkinConfig;
  /** When video is loaded we hold its URL here for canvas frame extraction. */
  videoUrl: string | null;
  videoReady: boolean;
  /** Hidden video element ref (set by canvas component, not stored). */
  // Selection state
  selectedShapeIds: string[];
  // Marquee / drag transform state
  dragTransform: {
    active: boolean;
    mode: "move" | "scale" | "rotate" | null;
    start: Vec2 | null;
    pivot: Vec2 | null;
  };
  /**
   * Canvas viewport state: zoom factor and pan offset (in screen-space pixels
   * relative to the canvas container's center). Zoom 1 = fit-to-container;
   * higher values zoom in. The canvas is rendered at native pixel size and
   * scaled via CSS transform — this avoids re-rasterizing the canvas content
   * on every zoom/pan, keeping the operation cheap.
   */
  view: {
    zoom: number;
    panX: number;
    panY: number;
  };
  /**
   * When the user holds Z or Space to temporarily pan, we remember the
   * previously active tool here so we can restore it on release. Null when
   * no temporary switch is active.
   */
  panModePreviousTool: ToolMode | null;
  /**
   * Which key initiated the current temporary pan mode: "z", "space", or
   * null. We track this so we can distinguish a Space TAP (which toggles
   * play/pause) from a Space HOLD+drag (which pans).
   */
  panModeSource: "z" | "space" | null;
  /**
   * Undo/redo history stacks. Each entry is a deep-cloned snapshot of the
   * `project` state taken BEFORE a mutating action. We keep up to 50
   * snapshots to bound memory. Undo pops from `undoStack`, pushes the
   * current state to `redoStack`, and restores the snapshot. Redo does
   * the reverse.
   */
  undoStack: RotoProject[];
  redoStack: RotoProject[];
  /**
   * Playback speed multiplier (0.25, 0.5, 1, 2). The playback loop
   * advances frames at `fps * playbackSpeed` per second.
   */
  playbackSpeed: number;
  /**
   * Whether optical-flow propagation is enabled. When enabled, a
   * "Propagate" button in the timeline takes the active sub-layer's
   * shapes at the current frame and propagates them forward across
   * subsequent frames using the video's optical flow, creating
   * keyframes at each frame. The user can pause at any frame,
   * manually correct, and re-propagate from there.
   */
  flowEnabled: boolean;
  /** Optical flow strength multiplier (0 = no motion, 1 = full flow, >1 = exaggerated). */
  flowStrength: number;
  /** Whether propagation is currently running (shows a progress indicator). */
  propagating: boolean;
  /** Propagation progress 0..100. */
  propagationProgress: number;


  // ---- Actions ----
  setVideo: (url: string, resolution: ResolutionConfig, frameCount: number) => void;
  setFps: (fps: WorkingFPS) => void;
  setResolution: (resolution: ResolutionConfig) => void;
  setProjectName: (name: string) => void;
  setActiveSubLayer: (subLayerId: string) => void;
  setTool: (mode: ToolMode) => void;
  setBrush: (partial: Partial<BrushConfig>) => void;
  setOnion: (partial: Partial<OnionSkinConfig>) => void;
  setCurrentFrame: (index: number) => void;
  toggleKeyframe: (index: number) => void;
  clearFrame: (index: number) => void;
  /** Set the playback speed multiplier. */
  setPlaybackSpeed: (speed: number) => void;
  /** Toggle optical flow propagation on/off. */
  setFlowEnabled: (enabled: boolean) => void;
  /** Set the optical flow strength multiplier. */
  setFlowStrength: (strength: number) => void;
  /**
   * Propagate the active sub-layer's shapes from `startFrame` to
   * `endFrame` using the video's optical flow. Creates keyframes at
   * each intermediate frame. The video element must be available for
   * frame extraction.
   */
  propagateFlow: (
    video: HTMLVideoElement,
    startFrame: number,
    endFrame: number
  ) => Promise<void>;
  /** Set the canvas viewport (zoom and/or pan). Partial updates merge. */
  setView: (partial: Partial<{ zoom: number; panX: number; panY: number }>) => void;
  /** Reset the canvas viewport to fit-to-container with no pan. */
  resetView: () => void;
  /** Undo the last mutating action. No-op if the undo stack is empty. */
  undo: () => void;
  /** Redo the last undone action. No-op if the redo stack is empty. */
  redo: () => void;
  /**
   * Push the current project state onto the undo stack and clear the redo
   * stack. Called by mutating actions BEFORE they apply their change so
   * that `undo` can restore the pre-change state.
   */
  pushHistory: () => void;
  /**
   * Enter temporary pan mode (Z or Space held). Remembers the previous tool
   * so it can be restored on `exitPanMode`. If already in pan mode, this is
   * a no-op. `source` is "z" or "space" so we can distinguish Space TAP from
   * Space HOLD+drag later.
   */
  enterPanMode: (source: "z" | "space") => void;
  /**
   * Exit temporary pan mode and restore the previously active tool.
   * No-op if not in pan mode. Also clears `panModeSource`.
   */
  exitPanMode: () => void;
  /** Add or replace shapes on the active sub-layer of the current frame. */
  commitShapes: (subLayerId: string, shapes: VectorShape[]) => void;
  /** Deform a shape's points (used by deform brush live). */
  liveDeformShape: (
    subLayerId: string,
    shapeId: string,
    mutate: (pts: Vec2[]) => Vec2[]
  ) => void;
  liveTransformShapes: (
    subLayerId: string,
    shapeIds: string[],
    mutate: (pts: Vec2[]) => Vec2[]
  ) => void;
  /**
   * Global deform brush: deforms ALL shapes within the radius of `lastMouse`
   * across ALL sub-layers in the parent layer that contains the active
   * sub-layer (or the layer identified by `layerId`). Used by the deform
   * tool when `brush.deformScope === "global"`.
   *
   * @param layerId The parent layer whose sub-layers should all be deformed.
   * @param brush   Brush state: last cursor position, radius, strength,
   *                and the cursor delta since the last mousemove.
   */
  liveDeformLayer: (
    layerId: string,
    brush: { lastMouse: Vec2; delta: Vec2; radius: number; strength: number }
  ) => void;
  selectShapes: (ids: string[]) => void;
  clearSelection: () => void;
  /**
   * Blob brush stroke commit: takes the user's stroke polyline, converts it
   * to a closed polygon (brush footprint), and boolean-unions it with all
   * existing shapes in the active sub-layer that share the same fill color.
   * The resulting merged shape replaces those originals.
   */
  commitBlobStroke: (
    subLayerId: string,
    points: Vec2[],
    fillColor: string,
    radius: number,
    strokeColor: string,
    strokeWidth: number,
    strokeEnabled: boolean,
    fillEnabled: boolean
  ) => void;
  /**
   * Knife tool: subtracts the cut path (closed) from all shapes in the active
   * sub-layer that intersect it. Each resulting piece becomes its own
   * independent VectorShape (so the user can recolor or delete it separately).
   */
  cutShapesWithKnife: (subLayerId: string, cutPath: Vec2[]) => void;
  /** Permanently remove a shape from a sub-layer's current frame state. */
  deleteShape: (subLayerId: string, shapeId: string) => void;
  /**
   * Delete a single node (control point) from a shape's outline. The shape
   * remains a closed polygon if it has ≥3 points after deletion; otherwise
   * the shape itself is removed.
   */
  deleteNode: (subLayerId: string, shapeId: string, nodeIndex: number) => void;
  /**
   * Set the fill color of a single shape. Used to recolor cut pieces
   * (e.g., darken a shirt fragment to make a precise shadow shape).
   */
  setShapeFillColor: (subLayerId: string, shapeId: string, color: string) => void;
  /**
   * Move a single node within a shape (used by the Node tool when dragging).
   */
  liveMoveNode: (
    subLayerId: string,
    shapeId: string,
    nodeIndex: number,
    target: Vec2
  ) => void;
  /**
   * Relax tool: redistribute the nodes of a shape within `radius` of `center`
   * at uniform arc-length intervals. Preserves the overall silhouette —
   * only resamples the in-range portion. Useful for cleaning up shapes
   * that have too many nodes or jittery node placement.
   */
  liveRelaxShape: (
    subLayerId: string,
    shapeId: string,
    center: Vec2,
    radius: number,
    spacing: number
  ) => void;
  /**
   * Insert a "drawing break" at the given frame for the given sub-layer.
   * This marks the start of a new independent drawing within the same
   * sub-layer: interpolation will not cross this break, and frames in the
   * new span (before the user draws the first keyframe) will be blank.
   * The active sub-layer's shapes at this frame are also cleared so the
   * drawing truly starts fresh.
   */
  insertDrawingBreak: (subLayerId: string, frameIndex: number) => void;
  /** Remove a drawing break. Re-enables interpolation across this frame. */
  removeDrawingBreak: (subLayerId: string, frameIndex: number) => void;
  /**
   * Toggle a drawing break (insert if absent, remove if present).
   * Convenience action for UI buttons.
   */
  toggleDrawingBreak: (subLayerId: string, frameIndex: number) => void;
  /**
   * Promote a single shape from an in-between frame into its own
   * keyframe shape, so node edits operate on a concrete shape. Returns
   * nothing — the shape id is preserved.
   */
  // Layer hierarchy ops
  addLayer: (name?: string) => void;
  addSubLayer: (layerId: string, name?: string) => void;
  renameLayer: (id: string, name: string) => void;
  renameSubLayer: (layerId: string, subId: string, name: string) => void;
  toggleLayerVisible: (id: string) => void;
  toggleLayerLocked: (id: string) => void;
  toggleSubLayerVisible: (layerId: string, subId: string) => void;
  toggleSubLayerLocked: (layerId: string, subId: string) => void;
  deleteLayer: (id: string) => void;
  deleteSubLayer: (layerId: string, subId: string) => void;
  reorderLayer: (id: string, direction: -1 | 1) => void;
  reorderSubLayer: (layerId: string, subId: string, direction: -1 | 1) => void;
  // Reset & import
  resetProject: () => void;
  loadProject: (proj: RotoProject) => void;
}

function emptyProject(): RotoProject {
  return {
    name: "Untitled Roto",
    fps: 12,
    resolution: {
      sourceWidth: 1280,
      sourceHeight: 720,
      workingWidth: 1280,
      workingHeight: 720,
      displayScale: 1,
    },
    frameCount: 24,
    layers: makeDefaultLayers(),
    frames: Array.from({ length: 24 }, (_, i) => ({
      index: i,
      isKeyframe: i === 0,
      states: {},
    })),
    currentFrame: 0,
    activeSubLayerId: null,
    drawingBreaks: {},
  };
}

/**
 * Recompute interpolated shapes for a given frame index, respecting drawing
 * breaks. The timeline is divided into spans by drawing breaks; interpolation
 * only happens within the same span. Frames in a new (broken) span before
 * the user draws the first keyframe are blank.
 */
export function getInterpolatedShapesForFrame(
  project: RotoProject,
  frameIndex: number,
  subLayerId: string
): VectorShape[] {
  const frame = project.frames[frameIndex];
  if (!frame) return [];
  // If keyframe and has data, return directly.
  if (frame.isKeyframe && frame.states[subLayerId]) {
    return frame.states[subLayerId];
  }
  // Find the drawing span [spanStart, spanEnd) for this sub-layer at this frame.
  // A break at frame B means the new span starts at B (inclusive).
  const breaks = (project.drawingBreaks?.[subLayerId] ?? [])
    .slice()
    .sort((a, b) => a - b);
  let spanStart = 0;
  let spanStartsAtBreak = false; // true if a break exists at or before frameIndex
  let spanEnd = project.frameCount;
  for (const b of breaks) {
    if (b <= frameIndex) {
      spanStart = b;
      spanStartsAtBreak = true;
    } else if (b > frameIndex && b < spanEnd) {
      spanEnd = b;
    }
  }
  // Find previous keyframe within [spanStart, frameIndex].
  let prevKf: Frame | null = null;
  for (let i = frameIndex; i >= spanStart; i--) {
    const f = project.frames[i];
    if (f.isKeyframe && f.states[subLayerId]) {
      prevKf = f;
      break;
    }
  }
  // Find next keyframe within (frameIndex, spanEnd).
  let nextKf: Frame | null = null;
  for (let i = frameIndex + 1; i < spanEnd; i++) {
    const f = project.frames[i];
    if (f.isKeyframe && f.states[subLayerId]) {
      nextKf = f;
      break;
    }
  }
  // Interpolate between prevKf and nextKf if both exist within the same span.
  if (prevKf && nextKf && prevKf !== nextKf) {
    const prevShapes = prevKf.states[subLayerId];
    const nextShapes = nextKf.states[subLayerId];
    if (!prevShapes || !nextShapes) return prevShapes ?? nextShapes ?? [];
    const span = nextKf.index - prevKf.index;
    const t = (frameIndex - prevKf.index) / span;
    // Match by index; assume same number of shapes per sub-layer.
    const n = Math.min(prevShapes.length, nextShapes.length);
    const out: VectorShape[] = [];
    for (let i = 0; i < n; i++) {
      out.push(interpolateShapes(prevShapes[i], nextShapes[i], t));
    }
    return out;
  }
  // Hold the last keyframe's shapes forward (standard animation behavior).
  if (prevKf) return prevKf.states[subLayerId] ?? [];
  // No previous keyframe in this span. If the span starts at a drawing break,
  // we want frames in the new span to be BLANK (the user inserted a break to
  // start a fresh drawing). If the span starts at frame 0 (no break yet),
  // preserve the original "hold backward from next keyframe" behavior.
  if (spanStartsAtBreak) return [];
  if (nextKf) return nextKf.states[subLayerId] ?? [];
  return [];
}

/** Helper: does this sub-layer have a drawing break at the given frame? */
export function hasDrawingBreak(
  project: RotoProject,
  subLayerId: string,
  frameIndex: number
): boolean {
  const breaks = project.drawingBreaks?.[subLayerId] ?? [];
  return breaks.includes(frameIndex);
}

/** Helper: get the sorted list of drawing breaks for a sub-layer (or []). */
export function getDrawingBreaks(
  project: RotoProject,
  subLayerId: string
): number[] {
  return (project.drawingBreaks?.[subLayerId] ?? []).slice().sort((a, b) => a - b);
}

/** Returns the active sub-layer object. */
export function getActiveSubLayer(project: RotoProject): SubLayer | null {
  if (!project.activeSubLayerId) return null;
  for (const layer of project.layers) {
    const sub = layer.subLayers.find((s) => s.id === project.activeSubLayerId);
    if (sub) return sub;
  }
  return null;
}

/** Initial active sub-layer = first sub-layer of first layer. */
function withDefaultActive(proj: RotoProject): RotoProject {
  if (!proj.activeSubLayerId && proj.layers.length > 0) {
    const firstSub = proj.layers[0].subLayers[0];
    if (firstSub) proj.activeSubLayerId = firstSub.id;
  }
  // Backward-compatibility: older project JSON may not have drawingBreaks.
  if (!proj.drawingBreaks) proj.drawingBreaks = {};
  // Backward-compatibility: older shapes may not have stroke.enabled (was
  // always true before this field was added). Default to true so legacy
  // projects keep their black outlines.
  for (const layer of proj.layers) {
    for (const sub of layer.subLayers) {
      // Sub-layer shapes (template — currently unused but kept for future).
      for (const sh of sub.shapes) {
        if (sh.stroke.enabled === undefined) sh.stroke.enabled = true;
      }
      // Per-frame keyframe states.
      for (const frame of proj.frames) {
        const states = frame.states[sub.id];
        if (states) {
          for (const sh of states) {
            if (sh.stroke.enabled === undefined) sh.stroke.enabled = true;
          }
        }
      }
    }
  }
  return proj;
}

export const useRotoStore = create<RotoState>((set, get) => ({
  project: withDefaultActive(emptyProject()),
  brush: makeDefaultBrush(),
  onion: makeDefaultOnion(),
  videoUrl: null,
  videoReady: false,
  selectedShapeIds: [],
  dragTransform: { active: false, mode: null, start: null, pivot: null },
  view: { zoom: 1, panX: 0, panY: 0 },
  panModePreviousTool: null,
  panModeSource: null,
  undoStack: [],
  redoStack: [],
  playbackSpeed: 1,
  flowEnabled: false,
  flowStrength: 1,
  propagating: false,
  propagationProgress: 0,
  setVideo: (url, resolution, frameCount) =>
    set((s) => {
      const frames = Array.from({ length: frameCount }, (_, i) => ({
        index: i,
        isKeyframe: i === 0,
        states: {} as Record<string, VectorShape[]>,
      }));
      return {
        videoUrl: url,
        videoReady: true,
        project: {
          ...s.project,
          resolution,
          frameCount,
          frames,
          currentFrame: 0,
          // Reset drawing breaks when a new video is loaded — the previous
          // break frame indices would be meaningless against a new timeline.
          drawingBreaks: {},
        },
      };
    }),

  setFps: (fps) => set((s) => ({ project: { ...s.project, fps } })),
  setResolution: (resolution) =>
    set((s) => ({ project: { ...s.project, resolution } })),
  setProjectName: (name) =>
    set((s) => ({ project: { ...s.project, name } })),

  setActiveSubLayer: (subLayerId) =>
    set((s) => ({
      project: { ...s.project, activeSubLayerId: subLayerId },
      selectedShapeIds: [],
    })),

  setTool: (mode) =>
    set((s) => ({
      brush: { ...s.brush, mode },
      selectedShapeIds: mode === "draw" ? [] : s.selectedShapeIds,
    })),

  setBrush: (partial) =>
    set((s) => ({ brush: { ...s.brush, ...partial } })),

  setOnion: (partial) =>
    set((s) => ({ onion: { ...s.onion, ...partial } })),

  setCurrentFrame: (index) =>
    set((s) => {
      const clamped = Math.max(0, Math.min(s.project.frameCount - 1, index));
      return {
        project: { ...s.project, currentFrame: clamped },
        selectedShapeIds: [],
      };
    }),

  toggleKeyframe: (index) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const f = frames[index];
      if (!f) return {};
      frames[index] = { ...f, isKeyframe: !f.isKeyframe };
      return { project: { ...s.project, frames } };
    });
  },

  clearFrame: (index) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const f = frames[index];
      if (!f) return {};
      frames[index] = { ...f, isKeyframe: false, states: {} };
      return { project: { ...s.project, frames } };
    });
  },

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  setFlowEnabled: (enabled) => set({ flowEnabled: enabled }),

  setFlowStrength: (strength) => set({ flowStrength: strength }),

  propagateFlow: async (video, startFrame, endFrame) => {
    const s = get();
    const { project } = s;
    const activeSubLayerId = project.activeSubLayerId;
    if (!activeSubLayerId || !video) return;

    // Get the shapes at the start frame (the "ground truth").
    let currentShapes = getInterpolatedShapesForFrame(project, startFrame, activeSubLayerId);
    if (currentShapes.length === 0) return;

    // Push a single history snapshot for the whole propagation.
    s.pushHistory();
    set({ propagating: true, propagationProgress: 0 });

    const { workingWidth, workingHeight } = project.resolution;
    const fps = project.fps;
    const totalFrames = endFrame - startFrame;

    // For each frame from startFrame+1 to endFrame:
    //   1. Seek video to frame N-1, extract grayscale → frameA
    //   2. Seek video to frame N, extract grayscale → frameB
    //   3. Compute optical flow from frameA → frameB
    //   4. Propagate each shape's points by the flow × strength
    //   5. Write the propagated shapes as a keyframe at frame N
    for (let frame = startFrame + 1; frame <= endFrame; frame++) {
      const prevTime = (frame - 1) / fps;
      const currTime = frame / fps;

      // Seek to previous frame.
      await seekVideoAndWait(video, prevTime);
      await new Promise((r) => setTimeout(r, 30));
      const frameA = extractGrayscaleFrame(video, workingWidth, workingHeight);
      if (!frameA) {
        set({ propagationProgress: Math.round(((frame - startFrame) / totalFrames) * 100) });
        continue;
      }

      // Seek to current frame.
      await seekVideoAndWait(video, currTime);
      await new Promise((r) => setTimeout(r, 30));
      const frameB = extractGrayscaleFrame(video, workingWidth, workingHeight);
      if (!frameB) {
        set({ propagationProgress: Math.round(((frame - startFrame) / totalFrames) * 100) });
        continue;
      }

      // Compute optical flow.
      const flow = computeOpticalFlow(frameA, frameB, workingWidth, workingHeight, 16, 8);

      // Propagate each shape's points.
      const strength = get().flowStrength;
      currentShapes = currentShapes.map((sh) => ({
        ...sh,
        points: propagatePointsByFlow(sh.points, flow, strength),
      }));

      // Write the propagated shapes as a keyframe at this frame.
      set((st) => {
        const frames = st.project.frames.slice();
        const f = frames[frame];
        if (!f) return {};
        frames[frame] = {
          ...f,
          isKeyframe: true,
          states: { ...f.states, [activeSubLayerId]: currentShapes.map((sh) => ({ ...sh, points: sh.points.map((p) => ({ x: p.x, y: p.y })) })) },
        };
        return { project: { ...st.project, frames } };
      });

      set({ propagationProgress: Math.round(((frame - startFrame) / totalFrames) * 100) });
    }

    set({ propagating: false, propagationProgress: 100 });
    // Reset progress after a short delay.
    setTimeout(() => set({ propagationProgress: 0 }), 2000);
  },

  setView: (partial) =>
    set((s) => ({ view: { ...s.view, ...partial } })),

  resetView: () => set({ view: { zoom: 1, panX: 0, panY: 0 } }),

  /**
   * Push a deep-cloned snapshot of the current project onto the undo stack
   * and clear the redo stack. Called by mutating actions BEFORE they apply
   * their change. We cap the undo stack at 50 entries to bound memory.
   */
  pushHistory: () =>
    set((s) => {
      const snapshot = JSON.parse(JSON.stringify(s.project)) as RotoProject;
      const undoStack = [...s.undoStack, snapshot];
      // Cap at 50 entries (drop the oldest).
      if (undoStack.length > 50) undoStack.shift();
      return { undoStack, redoStack: [] };
    }),

  undo: () =>
    set((s) => {
      if (s.undoStack.length === 0) return {};
      const previous = s.undoStack[s.undoStack.length - 1];
      const undoStack = s.undoStack.slice(0, -1);
      // Push the CURRENT state onto the redo stack so it can be re-applied.
      const currentSnapshot = JSON.parse(JSON.stringify(s.project)) as RotoProject;
      const redoStack = [...s.redoStack, currentSnapshot];
      return {
        project: previous,
        undoStack,
        redoStack,
        // Clear selection since the shape IDs may no longer exist.
        selectedShapeIds: [],
      };
    }),

  redo: () =>
    set((s) => {
      if (s.redoStack.length === 0) return {};
      const next = s.redoStack[s.redoStack.length - 1];
      const redoStack = s.redoStack.slice(0, -1);
      const currentSnapshot = JSON.parse(JSON.stringify(s.project)) as RotoProject;
      const undoStack = [...s.undoStack, currentSnapshot];
      return {
        project: next,
        undoStack,
        redoStack,
        selectedShapeIds: [],
      };
    }),

  enterPanMode: (source) =>
    set((s) => {
      // Already in pan mode — don't overwrite the saved tool.
      if (s.panModePreviousTool !== null) return {};
      return {
        panModePreviousTool: s.brush.mode,
        panModeSource: source,
        // Switch to a synthetic "select" tool which has no canvas interaction
        // — the canvas's pan-drag handler takes over while Z/Space is held.
        brush: { ...s.brush, mode: "select" },
      };
    }),

  exitPanMode: () =>
    set((s) => {
      if (s.panModePreviousTool === null) return {};
      const prev = s.panModePreviousTool;
      return {
        panModePreviousTool: null,
        panModeSource: null,
        brush: { ...s.brush, mode: prev },
      };
    }),

  commitShapes: (subLayerId, shapes) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      // If this frame was already a keyframe with shapes for this sub-layer,
      // APPEND the new shapes to the existing ones. Otherwise, REPLACE
      // any interpolated shapes (in-between frames shouldn't accumulate
      // interpolated shapes when the user starts editing — the user's edits
      // are an override of the interpolated state).
      const wasKeyframeWithShapes = f.isKeyframe && f.states[subLayerId];
      const merged = wasKeyframeWithShapes
        ? [...f.states[subLayerId], ...shapes]
        : shapes;
      // Auto-promote to keyframe when committing shapes.
      const next: Frame = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: merged },
      };
      frames[idx] = next;
      return { project: { ...s.project, frames } };
    });
  },

  liveDeformShape: (subLayerId, shapeId, mutate) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      // If this frame is an in-between (no shapes for this sub-layer yet),
      // seed it with the interpolated shapes so the deform has a target.
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
      }
      const nextShapes = existing.map((sh) =>
        sh.id === shapeId ? { ...sh, points: mutate(sh.points) } : sh
      );
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: nextShapes },
      };
      return { project: { ...s.project, frames } };
    }),

  liveTransformShapes: (subLayerId, shapeIds, mutate) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      // Same seeding behaviour as liveDeformShape: hydrate the frame from
      // interpolated shapes when starting a transform on an in-between frame.
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
      }
      const idSet = new Set(shapeIds);
      const nextShapes = existing.map((sh) =>
        idSet.has(sh.id) ? { ...sh, points: mutate(sh.points) } : sh
      );
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: nextShapes },
      };
      return { project: { ...s.project, frames } };
    }),

  /**
   * GLOBAL DEFORM: deform all shapes within the brush radius across ALL
   * sub-layers of the given parent layer. Each affected frame is auto-
   * promoted to a keyframe. The current frame's existing shape data is
   * mutated in place; previously-interpolated shapes are seeded first.
   */
  liveDeformLayer: (layerId, brushArg) =>
    set((s) => {
      const layer = s.project.layers.find((l) => l.id === layerId);
      if (!layer) return {};
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      const r = brushArg.radius;
      const r2 = r * r;
      const strength = brushArg.strength;
      const { lastMouse, delta } = brushArg;

      // For each sub-layer in this parent layer, deform points in radius.
      const nextStates: Record<string, VectorShape[]> = { ...f.states };
      let changed = false;
      for (const sub of layer.subLayers) {
        if (!sub.visible || sub.locked) continue;
        let existing = f.states[sub.id];
        if (!existing || existing.length === 0) {
          existing = getInterpolatedShapesForFrame(s.project, idx, sub.id);
          if (existing.length === 0) continue;
        }
        let subChanged = false;
        const nextShapes = existing.map((sh) => {
          let shapeChanged = false;
          const nextPoints = sh.points.map((pt) => {
            const ddx = pt.x - lastMouse.x;
            const ddy = pt.y - lastMouse.y;
            const dist2val = ddx * ddx + ddy * ddy;
            if (dist2val > r2) return pt;
            const falloff = 1 - Math.sqrt(dist2val) / r;
            shapeChanged = true;
            return {
              x: pt.x + delta.x * strength * falloff,
              y: pt.y + delta.y * strength * falloff,
            };
          });
          if (shapeChanged) {
            subChanged = true;
            return { ...sh, points: nextPoints };
          }
          return sh;
        });
        if (subChanged) {
          changed = true;
          nextStates[sub.id] = nextShapes;
        }
      }
      if (!changed) return {};
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: nextStates,
      };
      return { project: { ...s.project, frames } };
    }),

  /**
   * BLOB BRUSH STROKE COMMIT:
   * 1. Convert stroke to a closed polygon (brush footprint).
   * 2. Find existing shapes in the active sub-layer with the same fill color.
   * 3. Boolean-union the new footprint with all those shapes.
   * 4. Replace the originals with the resulting merged shape(s).
   */
  commitBlobStroke: (subLayerId, points, fillColor, radius, strokeColor, strokeWidth, strokeEnabled, fillEnabled) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      const newRing = strokeToPolygon(points, radius);
      if (!newRing) return {};
      // Hydrate from interpolation if this is an in-between.
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
      }
      // Partition: same-color shapes (will be unioned with new stroke) and
      // other-color shapes (preserved unchanged).
      const sameColor: VectorShape[] = [];
      const other: VectorShape[] = [];
      for (const sh of existing) {
        if (sh.fill.color.toLowerCase() === fillColor.toLowerCase() && sh.fill.closed) {
          sameColor.push(sh);
        } else {
          other.push(sh);
        }
      }
      // Build rings to union: new stroke + each same-color shape's outer ring.
      const rings: number[][][] = [newRing];
      for (const sh of sameColor) {
        const r = shapeToRing(sh);
        if (r) rings.push(r);
      }
      const multi = booleanUnion(rings);
      let merged = multiPolygonToShapes(multi, {
        stroke: {
          enabled: strokeEnabled,
          color: strokeColor,
          width: strokeWidth,
          jitter: 0,
          variance: 0,
        },
        fill: { enabled: fillEnabled, color: fillColor, closed: true },
      });
      // Safety net: if the boolean union produced zero shapes (e.g., the
      // polygon-clipping library rejected the input as degenerate), fall
      // back to treating the new stroke as a standalone shape. This keeps
      // the Blob brush usable even when strokes are very small or have
      // unusual geometry.
      if (merged.length === 0) {
        // Convert the new ring directly into a closed VectorShape.
        const points: Vec2[] = newRing.slice(0, -1).map((p) => ({
          x: p[0],
          y: p[1],
        }));
        if (points.length >= 3) {
          merged = [
            {
              id: uid("shape"),
              points,
              stroke: {
                enabled: strokeEnabled,
                color: strokeColor,
                width: strokeWidth,
                jitter: 0,
                variance: 0,
              },
              fill: { enabled: fillEnabled, color: fillColor, closed: true },
              seed: Math.floor(Math.random() * 1e9),
            },
          ];
        }
      }
      // Final state: other shapes + merged shapes.
      // If the frame was already a keyframe with shapes for this sub-layer,
      // APPEND the merged shapes to the other-color shapes (preserve them).
      // Otherwise REPLACE the (possibly interpolated) state with the new one.
      const wasKeyframeWithShapes = f.isKeyframe && f.states[subLayerId];
      const finalShapes = wasKeyframeWithShapes
        ? // The other shapes from the existing keyframe are kept; the same-color
          // ones are replaced by the merged result (since the new stroke was
          // unioned with them). So we keep f.states[subLayerId] minus the
          // same-color originals, plus the merged result.
          [
            ...(f.states[subLayerId] ?? []).filter(
              (sh) =>
                sh.fill.color.toLowerCase() !== fillColor.toLowerCase() ||
                !sh.fill.closed
            ),
            ...merged,
          ]
        : [...other, ...merged];
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: {
          ...f.states,
          [subLayerId]: finalShapes,
        },
      };
      return { project: { ...s.project, frames } };
    }),

  /**
   * KNIFE TOOL:
   * 1. Close the cut path if it has ≥2 points.
   * 2. Convert the cut path to a thin polygon "ribbon" (with a small thickness
   *    perpendicular to the path direction) so the boolean subtraction has
   *    an actual area to subtract — a perfectly straight line has zero area
   *    and can't cut anything.
   * 3. For each closed shape in the sub-layer, subtract the cut ribbon.
   * 4. The remaining pieces become independent VectorShape objects.
   * The result REPLACES all the original shapes that were cut.
   */
  cutShapesWithKnife: (subLayerId, cutPath) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      if (cutPath.length < 2) return {};
      // Convert the cut path to a thin "ribbon" polygon with a small
      // perpendicular thickness. A 1.5px half-width gives a 3px-wide cut
      // channel which is enough for the boolean engine to register.
      const halfWidth = 1.5;
      const leftPts: number[][] = [];
      const rightPts: number[][] = [];
      for (let i = 0; i < cutPath.length; i++) {
        const prev = cutPath[Math.max(0, i - 1)];
        const next = cutPath[Math.min(cutPath.length - 1, i + 1)];
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        // Normal: (-ty, tx)
        leftPts.push([cutPath[i].x - ty * halfWidth, cutPath[i].y + tx * halfWidth]);
        rightPts.push([cutPath[i].x + ty * halfWidth, cutPath[i].y - tx * halfWidth]);
      }
      // Build the cut ring: left points forward, then right points reversed,
      // then close back to the first left point.
      const cutRing: number[][] = [];
      for (const p of leftPts) cutRing.push([p[0], p[1]]);
      for (let i = rightPts.length - 1; i >= 0; i--) cutRing.push([rightPts[i][0], rightPts[i][1]]);
      cutRing.push([leftPts[0][0], leftPts[0][1]]);

      // Hydrate from interpolation if needed.
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
        if (existing.length === 0) return {};
      }
      const out: VectorShape[] = [];
      let anyCut = false;
      for (const sh of existing) {
        if (!sh.fill.closed) {
          out.push(sh);
          continue;
        }
        const ring = shapeToRing(sh);
        if (!ring) {
          out.push(sh);
          continue;
        }
        const result = booleanSubtract(ring, [cutRing]);
        if (result.length === 1 && result[0].length === 1) {
          // No cut happened — keep original.
          out.push(sh);
        } else {
          anyCut = true;
          const pieces = multiPolygonToShapes(result, {
            stroke: sh.stroke,
            fill: sh.fill,
          });
          out.push(...pieces);
        }
      }
      if (!anyCut) return {};
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: out },
      };
      return { project: { ...s.project, frames } };
    });
  },

  deleteShape: (subLayerId, shapeId) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
        if (existing.length === 0) return {};
      }
      const next = existing.filter((sh) => sh.id !== shapeId);
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: next },
      };
      return {
        project: { ...s.project, frames },
        selectedShapeIds: s.selectedShapeIds.filter((id) => id !== shapeId),
      };
    });
  },

  deleteNode: (subLayerId, shapeId, nodeIndex) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
        if (existing.length === 0) return {};
      }
      const next = existing
        .map((sh) => {
          if (sh.id !== shapeId) return sh;
          if (nodeIndex < 0 || nodeIndex >= sh.points.length) return sh;
          const newPoints = sh.points
            .slice(0, nodeIndex)
            .concat(sh.points.slice(nodeIndex + 1));
          if (newPoints.length < 3) {
            // Shape becomes degenerate — drop it.
            return null;
          }
          return { ...sh, points: newPoints };
        })
        .filter((sh): sh is VectorShape => sh !== null);
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: next },
      };
      return { project: { ...s.project, frames } };
    });
  },

  setShapeFillColor: (subLayerId, shapeId, color) => {
    get().pushHistory();
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
        if (existing.length === 0) return {};
      }
      const next = existing.map((sh) =>
        sh.id === shapeId
          ? { ...sh, fill: { ...sh.fill, color, enabled: true } }
          : sh
      );
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: next },
      };
      return { project: { ...s.project, frames } };
    });
  },

  liveMoveNode: (subLayerId, shapeId, nodeIndex, target) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
        if (existing.length === 0) return {};
      }
      const next = existing.map((sh) => {
        if (sh.id !== shapeId) return sh;
        if (nodeIndex < 0 || nodeIndex >= sh.points.length) return sh;
        const newPoints = sh.points.slice();
        newPoints[nodeIndex] = target;
        return { ...sh, points: newPoints };
      });
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: next },
      };
      return { project: { ...s.project, frames } };
    }),

  liveRelaxShape: (subLayerId, shapeId, center, radius, spacing) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const idx = s.project.currentFrame;
      const f = frames[idx];
      if (!f) return {};
      let existing = f.states[subLayerId];
      if (!existing || existing.length === 0) {
        existing = getInterpolatedShapesForFrame(s.project, idx, subLayerId);
        if (existing.length === 0) return {};
      }
      const next = existing.map((sh) => {
        if (sh.id !== shapeId) return sh;
        // Resample the in-range portion of the shape's points uniformly.
        const resampled = resampleWithinRadius(
          sh.points,
          center,
          radius,
          spacing,
          sh.fill.closed
        );
        // If the resampled array is identical (no change), return the original
        // to avoid unnecessary state churn.
        if (resampled.length === sh.points.length) {
          let same = true;
          for (let i = 0; i < resampled.length; i++) {
            if (
              resampled[i].x !== sh.points[i].x ||
              resampled[i].y !== sh.points[i].y
            ) {
              same = false;
              break;
            }
          }
          if (same) return sh;
        }
        return { ...sh, points: resampled };
      });
      frames[idx] = {
        ...f,
        isKeyframe: true,
        states: { ...f.states, [subLayerId]: next },
      };
      return { project: { ...s.project, frames } };
    }),

  insertDrawingBreak: (subLayerId, frameIndex) =>
    set((s) => {
      const existingBreaks = (s.project.drawingBreaks?.[subLayerId] ?? []).slice();
      if (existingBreaks.includes(frameIndex)) return {}; // already a break
      const breaks = [...existingBreaks, frameIndex].sort((a, b) => a - b);
      // Clear the sub-layer's shapes at this frame so the new drawing starts
      // truly blank. Other sub-layers' shapes on this frame are preserved.
      const frames = s.project.frames.slice();
      const f = frames[frameIndex];
      if (f) {
        const newStates = { ...f.states };
        delete newStates[subLayerId];
        frames[frameIndex] = { ...f, states: newStates };
      }
      return {
        project: {
          ...s.project,
          drawingBreaks: { ...s.project.drawingBreaks, [subLayerId]: breaks },
          frames,
        },
      };
    }),

  removeDrawingBreak: (subLayerId, frameIndex) =>
    set((s) => {
      const breaks = (s.project.drawingBreaks?.[subLayerId] ?? []).filter(
        (b) => b !== frameIndex
      );
      return {
        project: {
          ...s.project,
          drawingBreaks: { ...s.project.drawingBreaks, [subLayerId]: breaks },
        },
      };
    }),

  toggleDrawingBreak: (subLayerId, frameIndex) => {
    get().pushHistory();
    set((s) => {
      const existingBreaks = (s.project.drawingBreaks?.[subLayerId] ?? []).slice();
      const has = existingBreaks.includes(frameIndex);
      let breaks: number[];
      if (has) {
        breaks = existingBreaks.filter((b) => b !== frameIndex);
      } else {
        breaks = [...existingBreaks, frameIndex].sort((a, b) => a - b);
      }
      // When inserting a new break, also clear the sub-layer's shapes at this
      // frame so the new drawing starts truly blank.
      let frames = s.project.frames;
      if (!has) {
        frames = s.project.frames.slice();
        const f = frames[frameIndex];
        if (f) {
          const newStates = { ...f.states };
          delete newStates[subLayerId];
          frames[frameIndex] = { ...f, states: newStates };
        }
      }
      return {
        project: {
          ...s.project,
          drawingBreaks: { ...s.project.drawingBreaks, [subLayerId]: breaks },
          frames,
        },
      };
    });
  },

  selectShapes: (ids) => set({ selectedShapeIds: ids }),
  clearSelection: () => set({ selectedShapeIds: [] }),

  addLayer: (name) =>
    set((s) => {
      const id = uid("layer");
      const newLayer: Layer = {
        id,
        name: name ?? `Capa ${s.project.layers.length + 1}`,
        visible: true,
        locked: false,
        subLayers: [
          {
            id: uid("sub"),
            name: "Contorno",
            visible: true,
            locked: false,
            kind: "outline",
            shapes: [],
          },
          {
            id: uid("sub"),
            name: "Pleno",
            visible: true,
            locked: false,
            kind: "fill",
            shapes: [],
          },
        ],
      };
      return {
        project: {
          ...s.project,
          layers: [...s.project.layers, newLayer],
          activeSubLayerId: newLayer.subLayers[0].id,
        },
      };
    }),

  addSubLayer: (layerId, name) =>
    set((s) => {
      const layers = s.project.layers.slice();
      const idx = layers.findIndex((l) => l.id === layerId);
      if (idx < 0) return {};
      const newSub: SubLayer = {
        id: uid("sub"),
        name: name ?? `Sub ${layers[idx].subLayers.length + 1}`,
        visible: true,
        locked: false,
        kind: "custom",
        shapes: [],
      };
      layers[idx] = {
        ...layers[idx],
        subLayers: [...layers[idx].subLayers, newSub],
      };
      return {
        project: { ...s.project, layers, activeSubLayerId: newSub.id },
      };
    }),

  renameLayer: (id, name) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === id ? { ...l, name } : l
      );
      return { project: { ...s.project, layers } };
    }),

  renameSubLayer: (layerId, subId, name) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              subLayers: l.subLayers.map((sub) =>
                sub.id === subId ? { ...sub, name } : sub
              ),
            }
          : l
      );
      return { project: { ...s.project, layers } };
    }),

  toggleLayerVisible: (id) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      );
      return { project: { ...s.project, layers } };
    }),

  toggleLayerLocked: (id) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === id ? { ...l, locked: !l.locked } : l
      );
      return { project: { ...s.project, layers } };
    }),

  toggleSubLayerVisible: (layerId, subId) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              subLayers: l.subLayers.map((sub) =>
                sub.id === subId ? { ...sub, visible: !sub.visible } : sub
              ),
            }
          : l
      );
      return { project: { ...s.project, layers } };
    }),

  toggleSubLayerLocked: (layerId, subId) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              subLayers: l.subLayers.map((sub) =>
                sub.id === subId ? { ...sub, locked: !sub.locked } : sub
              ),
            }
          : l
      );
      return { project: { ...s.project, layers } };
    }),

  deleteLayer: (id) =>
    set((s) => {
      const layers = s.project.layers.filter((l) => l.id !== id);
      let active = s.project.activeSubLayerId;
      if (layers.length > 0) {
        const stillValid =
          layers.some((l) =>
            l.subLayers.some((sub) => sub.id === active)
          );
        if (!stillValid) active = layers[0].subLayers[0]?.id ?? null;
      } else {
        active = null;
      }
      return { project: { ...s.project, layers, activeSubLayerId: active } };
    }),

  deleteSubLayer: (layerId, subId) =>
    set((s) => {
      const layers = s.project.layers.map((l) =>
        l.id === layerId
          ? {
              ...l,
              subLayers: l.subLayers.filter((sub) => sub.id !== subId),
            }
          : l
      );
      let active = s.project.activeSubLayerId;
      const stillValid = layers.some((l) =>
        l.subLayers.some((sub) => sub.id === active)
      );
      if (!stillValid) {
        const firstSub = layers
          .flatMap((l) => l.subLayers)[0];
        active = firstSub?.id ?? null;
      }
      return { project: { ...s.project, layers, activeSubLayerId: active } };
    }),

  reorderLayer: (id, direction) =>
    set((s) => {
      const layers = s.project.layers.slice();
      const idx = layers.findIndex((l) => l.id === id);
      if (idx < 0) return {};
      const target = idx + direction;
      if (target < 0 || target >= layers.length) return {};
      [layers[idx], layers[target]] = [layers[target], layers[idx]];
      return { project: { ...s.project, layers } };
    }),

  reorderSubLayer: (layerId, subId, direction) =>
    set((s) => {
      const layers = s.project.layers.slice();
      const lidx = layers.findIndex((l) => l.id === layerId);
      if (lidx < 0) return {};
      const subs = layers[lidx].subLayers.slice();
      const sidx = subs.findIndex((sub) => sub.id === subId);
      if (sidx < 0) return {};
      const target = sidx + direction;
      if (target < 0 || target >= subs.length) return {};
      [subs[sidx], subs[target]] = [subs[target], subs[sidx]];
      layers[lidx] = { ...layers[lidx], subLayers: subs };
      return { project: { ...s.project, layers } };
    }),

  resetProject: () =>
    set({
      project: withDefaultActive(emptyProject()),
      brush: makeDefaultBrush(),
      onion: makeDefaultOnion(),
      videoUrl: null,
      videoReady: false,
      selectedShapeIds: [],
    }),

  loadProject: (proj) => set({ project: withDefaultActive(proj) }),
}));
