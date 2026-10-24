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
import { interpolateShapes, uid } from "./geometry";

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
    drawStrokeWidth: 3,
    drawStrokeJitter: 0.4,
    drawStrokeVariance: 0.2,
    fillColor: "#3b6fb5",
    autoClose: true,
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
  selectShapes: (ids: string[]) => void;
  clearSelection: () => void;
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
  };
}

/** Recompute interpolated shapes for a given frame index. */
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
  // Find previous and next keyframes for this sub-layer.
  let prevKf: Frame | null = null;
  let nextKf: Frame | null = null;
  for (let i = frameIndex; i >= 0; i--) {
    const f = project.frames[i];
    if (f.isKeyframe && f.states[subLayerId]) {
      prevKf = f;
      break;
    }
  }
  for (let i = frameIndex; i < project.frames.length; i++) {
    const f = project.frames[i];
    if (f.isKeyframe && f.states[subLayerId]) {
      nextKf = f;
      break;
    }
  }
  // If we have prevKf, we need to look at the prev keyframe's data
  // and the next keyframe's data, and interpolate.
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
  if (prevKf) return prevKf.states[subLayerId] ?? [];
  if (nextKf) return nextKf.states[subLayerId] ?? [];
  return [];
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

  toggleKeyframe: (index) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const f = frames[index];
      if (!f) return {};
      frames[index] = { ...f, isKeyframe: !f.isKeyframe };
      return { project: { ...s.project, frames } };
    }),

  clearFrame: (index) =>
    set((s) => {
      const frames = s.project.frames.slice();
      const f = frames[index];
      if (!f) return {};
      frames[index] = { ...f, isKeyframe: false, states: {} };
      return { project: { ...s.project, frames } };
    }),

  commitShapes: (subLayerId, shapes) =>
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
    }),

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
