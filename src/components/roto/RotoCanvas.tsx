"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRotoStore, getInterpolatedShapesForFrame } from "@/lib/roto/store";
import type { Vec2, VectorShape, Layer, SubLayer, ToolMode } from "@/lib/roto/types";
import {
  applyLineBoil,
  applySmoothingLevel,
  distanceToShape,
  nearestNode,
  pointInPolygon,
  shapeBBox,
  shapeToRing,
  uid,
} from "@/lib/roto/geometry";
import { BrushCursor } from "./BrushCursor";

interface Props {
  /** Hidden <video> element ref (rendered by parent for video frame extraction). */
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

interface LiveStroke {
  subLayerId: string;
  points: Vec2[];
}

export function RotoCanvas({ videoRef }: Props) {
  const project = useRotoStore((s) => s.project);
  const brush = useRotoStore((s) => s.brush);
  const onion = useRotoStore((s) => s.onion);
  const selectedShapeIds = useRotoStore((s) => s.selectedShapeIds);
  const commitShapes = useRotoStore((s) => s.commitShapes);
  const commitBlobStroke = useRotoStore((s) => s.commitBlobStroke);
  const cutShapesWithKnife = useRotoStore((s) => s.cutShapesWithKnife);
  const deleteShape = useRotoStore((s) => s.deleteShape);
  const deleteNode = useRotoStore((s) => s.deleteNode);
  const liveMoveNode = useRotoStore((s) => s.liveMoveNode);
  const liveDeformShape = useRotoStore((s) => s.liveDeformShape);
  const liveDeformLayer = useRotoStore((s) => s.liveDeformLayer);
  const liveTransformShapes = useRotoStore((s) => s.liveTransformShapes);
  const selectShapes = useRotoStore((s) => s.selectShapes);
  const clearSelection = useRotoStore((s) => s.clearSelection);
  const setBrush = useRotoStore((s) => s.setBrush);
  const toggleDrawingBreak = useRotoStore((s) => s.toggleDrawingBreak);
  const view = useRotoStore((s) => s.view);
  const setView = useRotoStore((s) => s.setView);
  const resetView = useRotoStore((s) => s.resetView);
  const enterPanMode = useRotoStore((s) => s.enterPanMode);
  const exitPanMode = useRotoStore((s) => s.exitPanMode);
  const panModePreviousTool = useRotoStore((s) => s.panModePreviousTool);
  const panModeSource = useRotoStore((s) => s.panModeSource);
  const undo = useRotoStore((s) => s.undo);
  const redo = useRotoStore((s) => s.redo);
  const pushHistory = useRotoStore((s) => s.pushHistory);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Offscreen canvas that caches the last successfully drawn video frame.
  // This prevents black-frame flicker when the video is mid-seek: instead of
  // clearing to black while the video element catches up, we re-draw the
  // last known good frame. The cache is invalidated (cleared) whenever the
  // video URL changes or the video fails to provide a frame.
  const videoFrameCacheRef = useRef<HTMLCanvasElement | null>(null);
  // Whether the <video> element is currently mid-seek. Set by the page's
  // seekVideo callback via a window event — we listen for "roto-seek-start"
  // and "roto-seek-end" custom events.
  const videoSeekingRef = useRef<boolean>(false);
  const [displayScale, setDisplayScale] = useState(1);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [cursorOverCanvas, setCursorOverCanvas] = useState(false);
  // Canvas's base (un-transformed) top-left position within the container, in
  // container-space pixels. The container is `flex items-center justify-center`,
  // so the canvas is naturally centered; this is its centered top-left. The
  // CSS `transform: translate(panX, panY) scale(zoom)` is then applied on top.
  // Used to position the BrushCursor / BlobCursor overlays correctly.
  const [canvasBase, setCanvasBase] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });
  // Selected node index within the selected shape (for Node tool).
  const [selectedNode, setSelectedNode] = useState<{
    shapeId: string;
    nodeIndex: number;
  } | null>(null);

  // Live drawing/deforming state (refs to avoid re-renders on every mouse move)
  const drawingRef = useRef<LiveStroke | null>(null);
  const deformingRef = useRef<
    | {
        scope: "local" | "global";
        subLayerId: string;       // local mode target
        layerId: string;          // global mode target
        shapeId: string;          // local mode only
        startMouse: Vec2;
        lastMouse: Vec2;
        /**
         * Snapshot of the shape(s)' points taken at mousedown. We deform
         * RELATIVE TO this snapshot, not incrementally — this makes the
         * deform track the cursor 1:1 (× strength × falloff) instead of
         * accumulating small deltas (which felt "exaggerated" because the
         * same drag distance was being applied to already-moved points).
         * For global scope, this is a map of subLayerId → array of
         * { shapeId, points }.
         */
        initialShapes: { subLayerId: string; shapeId: string; points: Vec2[] }[];
      }
    | null
  >(null);
  const selectingRef = useRef<{
    start: Vec2;
    marquee: Vec2 | null;
  } | null>(null);
  const transformRef = useRef<{
    subLayerId: string;
    shapeIds: string[];
    mode: "move" | "scale" | "rotate";
    start: Vec2;
    pivot: Vec2;
    initialPoints: Record<string, Vec2[]>;
  } | null>(null);
  // Node-tool drag state: dragging a single node within a selected shape.
  const nodeDragRef = useRef<{
    subLayerId: string;
    shapeId: string;
    nodeIndex: number;
  } | null>(null);
  // Pen-tool state: the in-progress polyline of anchor points. The user
  // clicks to add anchors; we render a rubber-band preview from the last
  // anchor to the cursor. Double-click or Enter finishes the path and commits
  // it as a VectorShape. Escape cancels.
  const penPathRef = useRef<{
    subLayerId: string;
    points: Vec2[];
  } | null>(null);
  // Pan-mode drag state: when Z or Space is held, drag pans the canvas. Stores
  // the last cursor position so we can compute the delta on each mousemove.
  const panDragRef = useRef<{
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  // Space-tap vs hold+drag detection: when Space is pressed we record the
  // timestamp. The canvas's mousedown handler (when in space pan mode) sets
  // `spaceDragOccurredRef` to true. On keyup, if no drag occurred AND the
  // press was short (< 350 ms), we treat it as a TAP and toggle play/pause.
  const spacePressedAtRef = useRef<number>(0);
  const spaceDragOccurredRef = useRef<boolean>(false);
  const SPACE_TAP_MAX_MS = 350;

  // ----- Clear node selection whenever the tool changes -----
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedNode(null);
  }, [brush.mode]);

  // ----- Listen for video seek events from the page -----
  // The page's seekVideo callback dispatches "roto-seek-start" before setting
  // currentTime and "roto-seek-end" on the video's `seeked` event. We use this
  // to know when the video element is mid-seek so the draw loop can fall back
  // to the cached frame (preventing black-frame flicker).
  useEffect(() => {
    const onStart = () => {
      videoSeekingRef.current = true;
    };
    const onEnd = () => {
      videoSeekingRef.current = false;
    };
    window.addEventListener("roto-seek-start", onStart);
    window.addEventListener("roto-seek-end", onEnd);
    return () => {
      window.removeEventListener("roto-seek-start", onStart);
      window.removeEventListener("roto-seek-end", onEnd);
    };
  }, []);

  // ----- Display scale: fit canvas into container -----

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onResize = () => {
      // Reserve 24px of padding around the canvas so it doesn't touch the
      // container edges.
      const cw = container.clientWidth - 24;
      const ch = container.clientHeight - 24;
      const sw = project.resolution.workingWidth;
      const sh = project.resolution.workingHeight;
      const scale = Math.min(cw / sw, ch / sh, 2);
      setDisplayScale(scale);
      // Compute the canvas's base (un-transformed) top-left position within
      // the container. The container is `flex items-center justify-center`, so
      // the canvas's natural centered position is:
      //   baseLeft = (container.clientWidth - canvasDisplayW) / 2
      //   baseTop  = (container.clientHeight - canvasDisplayH) / 2
      // where canvasDisplayW = workingWidth * scale. We store this so the
      // BrushCursor / BlobCursor overlays (which are positioned absolutely
      // inside the container) can be placed correctly relative to the canvas
      // after the CSS transform is applied.
      const baseLeft =
        (container.clientWidth - sw * scale) / 2;
      const baseTop =
        (container.clientHeight - sh * scale) / 2;
      setCanvasBase({ left: baseLeft, top: baseTop });
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [project.resolution.workingWidth, project.resolution.workingHeight]);

  // ----- Map mouse event to canvas-space coordinates -----

  const toCanvasCoords = useCallback(
    (e: React.MouseEvent | MouseEvent): Vec2 => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) *
        project.resolution.workingWidth;
      const y = ((e.clientY - rect.top) / rect.height) *
        project.resolution.workingHeight;
      return { x, y };
    },
    [project.resolution.workingWidth, project.resolution.workingHeight]
  );

  // ----- Hit-testing: which shape is under the cursor -----
  // Returns the topmost shape that (a) is near the cursor (within the stroke
  // hit-distance of the outline), OR (b) contains the cursor inside its
  // filled area (for closed shapes). The latter is important so the user can
  // click anywhere inside a fill block to grab it, not just on its outline.

  const findShapeAt = useCallback(
    (p: Vec2): { subLayer: SubLayer; shape: VectorShape; layer: Layer } | null => {
      // Iterate layers bottom → top, so the topmost layer gets first hit.
      // Within a layer, bottom sublayer in z-stack gets drawn first, so iterate reversed.
      for (let li = project.layers.length - 1; li >= 0; li--) {
        const layer = project.layers[li];
        if (!layer.visible || layer.locked) continue;
        for (let si = layer.subLayers.length - 1; si >= 0; si--) {
          const sub = layer.subLayers[si];
          if (!sub.visible || sub.locked) continue;
          const shapes = getInterpolatedShapesForFrame(
            project,
            project.currentFrame,
            sub.id
          );
          for (let shi = shapes.length - 1; shi >= 0; shi--) {
            const sh = shapes[shi];
            const d = distanceToShape(p, sh);
            const hitDist = Math.max(6, sh.stroke.width + 4);
            if (d <= hitDist) {
              return { subLayer: sub, shape: sh, layer };
            }
            // Also: if the shape is closed & filled, check if the cursor is
            // inside the polygon (so a click anywhere on the fill selects it).
            if (sh.fill.closed && sh.fill.enabled) {
              const ring = shapeToRing(sh);
              if (ring && pointInPolygon(p, ring)) {
                return { subLayer: sub, shape: sh, layer };
              }
            }
          }
        }
      }
      return null;
    },
    [project]
  );

  // ----- Pointer event handlers -----

  /**
   * Find which (sub-layer, shape, node index) is under the cursor for the
   * Node tool. Returns the nearest node within `nodeSnapRadius` of a shape
   * that is selected (or that the user is about to select).
   */
  const findNodeAt = useCallback(
    (p: Vec2, snapRadius: number): {
      subLayer: SubLayer;
      shape: VectorShape;
      layer: Layer;
      nodeIndex: number;
    } | null => {
      // First check the currently selected shapes for a near node (priority).
      const selSet = new Set(selectedShapeIds);
      for (let li = project.layers.length - 1; li >= 0; li--) {
        const layer = project.layers[li];
        if (!layer.visible || layer.locked) continue;
        for (let si = layer.subLayers.length - 1; si >= 0; si--) {
          const sub = layer.subLayers[si];
          if (!sub.visible || sub.locked) continue;
          const shapes = getInterpolatedShapesForFrame(
            project,
            project.currentFrame,
            sub.id
          );
          for (const sh of shapes) {
            if (!selSet.has(sh.id)) continue;
            const idx = nearestNode(sh, p, snapRadius);
            if (idx >= 0) {
              return { subLayer: sub, shape: sh, layer, nodeIndex: idx };
            }
          }
        }
      }
      // Then any other shape (if user clicks on a node of an unselected shape).
      for (let li = project.layers.length - 1; li >= 0; li--) {
        const layer = project.layers[li];
        if (!layer.visible || layer.locked) continue;
        for (let si = layer.subLayers.length - 1; si >= 0; si--) {
          const sub = layer.subLayers[si];
          if (!sub.visible || sub.locked) continue;
          const shapes = getInterpolatedShapesForFrame(
            project,
            project.currentFrame,
            sub.id
          );
          for (const sh of shapes) {
            if (selSet.has(sh.id)) continue;
            const idx = nearestNode(sh, p, snapRadius);
            if (idx >= 0) {
              return { subLayer: sub, shape: sh, layer, nodeIndex: idx };
            }
          }
        }
      }
      return null;
    },
    [project, selectedShapeIds]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 2) return; // right-click ignored
      // If we're in temporary pan mode (Z or Space held), start a pan drag
      // instead of any tool action. Middle-mouse button also pans (a common
      // convention in graphics editors).
      if (panModePreviousTool !== null || e.button === 1) {
        panDragRef.current = { lastClientX: e.clientX, lastClientY: e.clientY };
        // If we're panning via Space, mark that a drag occurred so the
        // subsequent keyup doesn't trigger a play/pause tap.
        if (panModeSource === "space") {
          spaceDragOccurredRef.current = true;
        }
        e.preventDefault();
        return;
      }
      const p = toCanvasCoords(e);
      const mode = brush.mode;
      const activeSubLayerId = project.activeSubLayerId;

      if (mode === "pen") {
        // Pen tool: click adds an anchor. If there's already a pen path in
        // progress and the click is very close to the last anchor, treat it
        // as a finish (single click is enough on a degenerate case). The
        // real "finish" is double-click or Enter (handled in the keyboard
        // effect below).
        if (!activeSubLayerId) return;
        if (!penPathRef.current) {
          penPathRef.current = {
            subLayerId: activeSubLayerId,
            points: [p],
          };
        } else {
          // Don't add a duplicate point if the click is on top of the last
          // anchor (this happens on a double-click's first click).
          const last = penPathRef.current.points[penPathRef.current.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) > 2) {
            penPathRef.current.points.push(p);
          }
        }
        return;
      }

      if (mode === "draw" || mode === "blob" || mode === "knife") {
        if (!activeSubLayerId) return;
        drawingRef.current = {
          subLayerId: activeSubLayerId,
          points: [p],
        };
      } else if (mode === "deform") {
        // Two scopes:
        //   - "global": find the parent layer of the active sub-layer, deform
        //     ALL its sub-layers within radius. No need to hit-test specific shape.
        //   - "local" (default): find the specific shape under cursor, deform only it.
        // Push a single history snapshot for the entire deform drag so that
        // one Ctrl+Z undoes the whole drag (not per-mousemove).
        pushHistory();
        if (brush.deformScope === "global") {
          // Determine the parent layer containing the active sub-layer.
          let activeLayer: Layer | null = null;
          for (const layer of project.layers) {
            if (layer.subLayers.some((s) => s.id === activeSubLayerId)) {
              activeLayer = layer;
              break;
            }
          }
          if (!activeLayer) return;
          // Snapshot all visible/unlocked sub-layers' shape points so we can
          // deform relative to the initial position (no compounding).
          const initialShapes: { subLayerId: string; shapeId: string; points: Vec2[] }[] = [];
          for (const sub of activeLayer.subLayers) {
            if (!sub.visible || sub.locked) continue;
            const shapes = getInterpolatedShapesForFrame(
              project,
              project.currentFrame,
              sub.id
            );
            for (const sh of shapes) {
              initialShapes.push({
                subLayerId: sub.id,
                shapeId: sh.id,
                points: sh.points.map((p2) => ({ x: p2.x, y: p2.y })),
              });
            }
          }
          deformingRef.current = {
            scope: "global",
            subLayerId: activeSubLayerId ?? "",
            layerId: activeLayer.id,
            shapeId: "",
            startMouse: p,
            lastMouse: p,
            initialShapes,
          };
        } else {
          const hit = findShapeAt(p);
          if (!hit) return;
          // Snapshot the shape's points.
          deformingRef.current = {
            scope: "local",
            subLayerId: hit.subLayer.id,
            layerId: "",
            shapeId: hit.shape.id,
            startMouse: p,
            lastMouse: p,
            initialShapes: [
              {
                subLayerId: hit.subLayer.id,
                shapeId: hit.shape.id,
                points: hit.shape.points.map((p2) => ({ x: p2.x, y: p2.y })),
              },
            ],
          };
        }
      } else if (mode === "node") {
        // First try to hit a node of an already-selected shape.
        const nodeHit = findNodeAt(p, brush.nodeSnapRadius);
        if (nodeHit) {
          // Select the shape (if not already selected) and start node drag.
          if (!selectedShapeIds.includes(nodeHit.shape.id)) {
            selectShapes([nodeHit.shape.id]);
          }
          setSelectedNode({
            shapeId: nodeHit.shape.id,
            nodeIndex: nodeHit.nodeIndex,
          });
          // Push a single history snapshot for the entire node drag so that
          // one Ctrl+Z undoes the whole drag (not per-mousemove).
          pushHistory();
          nodeDragRef.current = {
            subLayerId: nodeHit.subLayer.id,
            shapeId: nodeHit.shape.id,
            nodeIndex: nodeHit.nodeIndex,
          };
        } else {
          // Try to select a shape by clicking its outline.
          const hit = findShapeAt(p);
          if (hit) {
            selectShapes([hit.shape.id]);
            setSelectedNode(null);
          } else {
            clearSelection();
            setSelectedNode(null);
          }
        }
      } else if (mode === "select") {
        // If we click on a selected shape, start a transform. Otherwise marquee.
        const hit = findShapeAt(p);
        const hitId = hit?.shape.id ?? null;
        if (hitId && selectedShapeIds.includes(hitId)) {
          // Begin move transform (scale & rotate via modifier keys)
          const subLayerId = hit!.subLayer.id;
          const shapes = getInterpolatedShapesForFrame(
            project,
            project.currentFrame,
            subLayerId
          ).filter((s) => selectedShapeIds.includes(s.id));
          // Push a single history snapshot for the entire transform drag.
          pushHistory();
          const allPoints = shapes.flatMap((s) => s.points);
          const bbox = shapeBBox(allPoints);
          const pivot = {
            x: (bbox.minX + bbox.maxX) / 2,
            y: (bbox.minY + bbox.maxY) / 2,
          };
          transformRef.current = {
            subLayerId,
            shapeIds: selectedShapeIds,
            mode: e.shiftKey ? "scale" : e.altKey ? "rotate" : "move",
            start: p,
            pivot,
            initialPoints: Object.fromEntries(
              shapes.map((s) => [s.id, s.points.slice()])
            ),
          };
        } else if (hitId) {
          // Select clicked shape
          selectShapes([hitId]);
        } else {
          // Start marquee selection
          selectingRef.current = { start: p, marquee: p };
          clearSelection();
        }
      }
    },
    [
      brush.mode,
      brush.deformScope,
      brush.nodeSnapRadius,
      project,
      findShapeAt,
      findNodeAt,
      selectedShapeIds,
      selectShapes,
      clearSelection,
      toCanvasCoords,
      panModePreviousTool,
      panModeSource,
      pushHistory,
    ]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Pan drag takes priority over everything else.
      if (panDragRef.current) {
        const dx = e.clientX - panDragRef.current.lastClientX;
        const dy = e.clientY - panDragRef.current.lastClientY;
        panDragRef.current.lastClientX = e.clientX;
        panDragRef.current.lastClientY = e.clientY;
        setView({
          panX: view.panX + dx,
          panY: view.panY + dy,
        });
        return;
      }
      const p = toCanvasCoords(e);
      setCursor(p);

      // Drawing — append point if moved sufficiently far (smoothing)
      if (drawingRef.current) {
        const last = drawingRef.current.points[drawingRef.current.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 2) {
          drawingRef.current.points.push(p);
        }
        return;
      }

      // Deforming — push/pull points within brush radius.
      // We deform relative to the snapshot taken at mousedown (`d.startMouse`
      // and `d.initialShapes`), NOT incrementally. This makes the deform
      // track the cursor 1:1 (× strength × falloff): points near where you
      // started dragging follow the cursor proportionally to the strength,
      // points at the brush edge don't move. The previous incremental approach
      // made the shape drift in surprising directions because the falloff was
      // re-computed each frame against the already-moved points.
      if (deformingRef.current) {
        const d = deformingRef.current;
        // Total cursor displacement since mousedown.
        const totalDx = p.x - d.startMouse.x;
        const totalDy = p.y - d.startMouse.y;
        const r = brush.deformRadius;
        const strength = brush.deformStrength;
        if (d.scope === "global") {
          // Global deform: deform every shape in the parent layer whose
          // INITIAL position was within the brush radius of startMouse.
          for (const init of d.initialShapes) {
            liveDeformShape(
              init.subLayerId,
              init.shapeId,
              () =>
                init.points.map((pt) => {
                  const ddx = pt.x - d.startMouse.x;
                  const ddy = pt.y - d.startMouse.y;
                  const dist2val = ddx * ddx + ddy * ddy;
                  if (dist2val > r * r) return pt;
                  // Linear falloff: 1 at cursor start, 0 at brush edge.
                  const falloff = 1 - Math.sqrt(dist2val) / r;
                  return {
                    x: pt.x + totalDx * strength * falloff,
                    y: pt.y + totalDy * strength * falloff,
                  };
                })
            );
          }
        } else {
          // Local deform: deform only the shape under cursor.
          const init = d.initialShapes[0];
          if (init) {
            liveDeformShape(d.subLayerId, d.shapeId, () =>
              init.points.map((pt) => {
                const ddx = pt.x - d.startMouse.x;
                const ddy = pt.y - d.startMouse.y;
                const dist2val = ddx * ddx + ddy * ddy;
                if (dist2val > r * r) return pt;
                const falloff = 1 - Math.sqrt(dist2val) / r;
                return {
                  x: pt.x + totalDx * strength * falloff,
                  y: pt.y + totalDy * strength * falloff,
                };
              })
            );
          }
        }
        d.lastMouse = p;
        return;
      }

      // Node tool drag — move the selected node to the cursor.
      if (nodeDragRef.current) {
        const nd = nodeDragRef.current;
        liveMoveNode(nd.subLayerId, nd.shapeId, nd.nodeIndex, p);
        return;
      }

      // Selecting — update marquee box
      if (selectingRef.current) {
        selectingRef.current.marquee = p;
        return;
      }

      // Transforming selected shapes
      if (transformRef.current) {
        const t = transformRef.current;
        const moveDx = p.x - t.start.x;
        const moveDy = p.y - t.start.y;
        const pivot = t.pivot;
        if (t.mode === "move") {
          liveTransformShapes(
            t.subLayerId,
            t.shapeIds,
            (pts) => pts.map((pt) => ({ x: pt.x + moveDx, y: pt.y + moveDy }))
          );
        } else if (t.mode === "scale") {
          const initialDist =
            Math.hypot(t.start.x - pivot.x, t.start.y - pivot.y) || 1;
          const curDist = Math.hypot(p.x - pivot.x, p.y - pivot.y);
          const s = curDist / initialDist;
          // Apply scale relative to pivot, using current points as the source
          liveTransformShapes(t.subLayerId, t.shapeIds, (pts) =>
            pts.map((pt) => {
              const dxp = pt.x - pivot.x - moveDx;
              const dyp = pt.y - pivot.y - moveDy;
              return {
                x: pivot.x + moveDx + dxp * s,
                y: pivot.y + moveDy + dyp * s,
              };
            })
          );
        } else if (t.mode === "rotate") {
          const a0 = Math.atan2(t.start.y - pivot.y, t.start.x - pivot.x);
          const a1 = Math.atan2(p.y - pivot.y, p.x - pivot.x);
          const da = a1 - a0;
          const cos = Math.cos(da);
          const sin = Math.sin(da);
          liveTransformShapes(t.subLayerId, t.shapeIds, (pts) =>
            pts.map((pt) => {
              const dxp = pt.x - pivot.x - moveDx;
              const dyp = pt.y - pivot.y - moveDy;
              return {
                x: pivot.x + moveDx + dxp * cos - dyp * sin,
                y: pivot.y + moveDy + dxp * sin + dyp * cos,
              };
            })
          );
        }
        return;
      }
    },
    [brush.deformRadius, brush.deformStrength, liveDeformShape, liveDeformLayer, liveMoveNode, liveTransformShapes, toCanvasCoords, view, setView]
  );

  const onMouseUp = useCallback(() => {
    // Finalize pan drag — just clear the ref; view state was already updated
    // continuously during mousemove.
    if (panDragRef.current) {
      panDragRef.current = null;
      return;
    }
    // Finalize drawing — draw / blob / knife all use drawingRef
    if (drawingRef.current) {
      const d = drawingRef.current;
      // First pass: simplify (drop near-duplicate points from hand tremor).
      let pts = simplifyPoints(d.points, 2);
      const mode = brush.mode;
      if (mode === "blob" && pts.length >= 1) {
        // Apply smoothing to the stroke before converting to a polygon.
        // For blob strokes we smooth as a CLOSED polyline so the start/end
        // join cleanly when the polygon is closed.
        if (brush.blobSmoothing > 0 && pts.length >= 3) {
          pts = applySmoothingLevel(pts, brush.blobSmoothing, true);
        }
        // Blob brush: convert stroke to polygon footprint and boolean-union
        // with existing same-color shapes in this sub-layer.
        commitBlobStroke(
          d.subLayerId,
          pts,
          brush.fillColor,
          brush.blobBrushRadius,
          "#000000", // black comic outline
          brush.drawStrokeWidth,
          brush.drawStrokeEnabled,
          brush.drawFillEnabled
        );
      } else if (mode === "knife" && pts.length >= 2) {
        // Knife cuts don't benefit from smoothing — keep raw points.
        cutShapesWithKnife(d.subLayerId, pts);
      } else if (mode === "draw" && pts.length >= 2) {
        // Apply smoothing for the Draw tool. For an open stroke we keep
        // the endpoints fixed (the cursor's start and end positions).
        if (brush.drawSmoothing > 0 && pts.length >= 3) {
          pts = applySmoothingLevel(pts, brush.drawSmoothing, brush.autoClose);
        }
        const newShape: VectorShape = {
          id: uid("shape"),
          points: pts,
          stroke: {
            enabled: brush.drawStrokeEnabled,
            color: "#000000", // black comic outline by default
            width: brush.drawStrokeWidth,
            jitter: brush.drawStrokeJitter,
            variance: brush.drawStrokeVariance,
          },
          fill: {
            enabled: brush.drawFillEnabled,
            color: brush.fillColor,
            closed: brush.autoClose,
          },
          seed: Math.floor(Math.random() * 1e9),
        };
        // Send ONLY the new shape to commitShapes. The store is responsible
        // for deciding whether to APPEND (when this is already a keyframe with
        // shapes for this sub-layer) or REPLACE (when the frame was an
        // in-between that should now be promoted to a keyframe). Appending the
        // interpolated shapes here would double-up shapes when starting to
        // edit an in-between frame.
        commitShapes(d.subLayerId, [newShape]);
      }
      drawingRef.current = null;
    }

    // Finalize deform — already committed live; nothing else to do.
    if (deformingRef.current) {
      deformingRef.current = null;
    }

    // Finalize node drag.
    if (nodeDragRef.current) {
      nodeDragRef.current = null;
    }

    // Finalize marquee selection
    if (selectingRef.current) {
      const sel = selectingRef.current;
      if (sel.marquee) {
        const minX = Math.min(sel.start.x, sel.marquee.x);
        const maxX = Math.max(sel.start.x, sel.marquee.x);
        const minY = Math.min(sel.start.y, sel.marquee.y);
        const maxY = Math.max(sel.start.y, sel.marquee.y);
        const hits: string[] = [];
        for (const layer of project.layers) {
          if (!layer.visible || layer.locked) continue;
          for (const sub of layer.subLayers) {
            if (!sub.visible || sub.locked) continue;
            const shapes = getInterpolatedShapesForFrame(
              project,
              project.currentFrame,
              sub.id
            );
            for (const sh of shapes) {
              const bb = shapeBBox(sh.points);
              if (
                bb.minX >= minX &&
                bb.maxX <= maxX &&
                bb.minY >= minY &&
                bb.maxY <= maxY
              ) {
                hits.push(sh.id);
              }
            }
          }
        }
        if (hits.length > 0) selectShapes(hits);
      }
      selectingRef.current = null;
    }

    // Finalize transform
    if (transformRef.current) {
      transformRef.current = null;
    }
  }, [
    brush,
    project,
    commitShapes,
    commitBlobStroke,
    cutShapesWithKnife,
    selectShapes,
  ]);

  // ----- Keyboard: Delete key removes selected shape or selected node -----
  // Active only when the canvas (or container) is hovered/focused.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore typing in inputs
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // "B" key — toggle a drawing break at the current frame for the active
      // sub-layer. Lets the user start a fresh drawing without reaching for
      // the toolbar.
      if (e.key === "b" || e.key === "B") {
        if (project.activeSubLayerId) {
          toggleDrawingBreak(project.activeSubLayerId, project.currentFrame);
          e.preventDefault();
        }
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // Node tool + selected node → delete the node.
      if (selectedNode && project.activeSubLayerId) {
        deleteNode(
          project.activeSubLayerId,
          selectedNode.shapeId,
          selectedNode.nodeIndex
        );
        setSelectedNode(null);
        e.preventDefault();
        return;
      }
      // Otherwise, delete all selected shapes (only from the active sub-layer,
      // to keep things simple — multi-sub-layer delete would be ambiguous).
      if (selectedShapeIds.length > 0 && project.activeSubLayerId) {
        for (const id of selectedShapeIds) {
          deleteShape(project.activeSubLayerId, id);
        }
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedNode,
    selectedShapeIds,
    project.activeSubLayerId,
    project.currentFrame,
    deleteNode,
    deleteShape,
    toggleDrawingBreak,
  ]);

  // ----- Mouse wheel: zoom in/out at the cursor position -----
  // Always zooms (regardless of tool). The deform/blob brush radius is now
  // adjusted via the [ and ] keyboard shortcuts.
  //
  // The zoom is anchored to the cursor: the canvas-space point under the
  // cursor stays under the cursor after the zoom. We achieve this by
  // computing the new pan offset so that:
  //   (clientX - newPanX) / newZoom = (clientX - oldPanX) / oldZoom
  // where panX/panY are screen-space offsets of the canvas's top-left corner
  // relative to the container's top-left.

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault?.();
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      // Cursor position relative to the container (which is the canvas's
      // parent and the origin of the CSS transform we apply).
      const cx = e.clientX - containerRect.left;
      const cy = e.clientY - containerRect.top;
      const oldZoom = view.zoom;
      // Zoom factor: scroll up = zoom in, scroll down = zoom out.
      // Multiplicative step keeps the feel smooth.
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nextZoom = Math.max(0.1, Math.min(16, oldZoom * factor));
      if (nextZoom === oldZoom) return;
      // Compute the canvas's current screen-space top-left from the
      // container's coordinate system. The canvas is centered in the
      // container at zoom 1, then pan is applied. We compute the canvas's
      // "natural" centered position (without pan) and then apply pan.
      // Actually, the CSS uses transform: translate(panX, panY) scale(zoom)
      // applied to a canvas whose base size is workingW*displayScale ×
      // workingH*displayScale, centered in the container via flexbox.
      // The canvas's top-left (in container coords) before transform is:
      //   baseLeft = (container.width - canvasW*displayScale) / 2
      //   baseTop  = (container.height - canvasH*displayScale) / 2
      // After transform: topLeft = baseLeft + panX (panY similarly), and
      // the cursor's offset from the canvas's top-left in canvas-pixel space
      // (before scaling) is: (cx - (baseLeft + panX)) / (displayScale * zoom)
      // To anchor zoom to cursor: this offset must stay the same.
      //   (cx - (baseLeft + newPanX)) / (displayScale * newZoom) =
      //   (cx - (baseLeft + oldPanX)) / (displayScale * oldZoom)
      // Solve for newPanX:
      //   newPanX = cx - baseLeft - (cx - baseLeft - oldPanX) * newZoom / oldZoom
      // (Same for newPanY with cy/baseTop.)
      const baseLeft =
        (container.clientWidth -
          project.resolution.workingWidth * displayScale) /
        2;
      const baseTop =
        (container.clientHeight -
          project.resolution.workingHeight * displayScale) /
        2;
      const newPanX =
        cx - baseLeft - (cx - baseLeft - view.panX) * (nextZoom / oldZoom);
      const newPanY =
        cy - baseTop - (cy - baseTop - view.panY) * (nextZoom / oldZoom);
      setView({ zoom: nextZoom, panX: newPanX, panY: newPanY });
    },
    [view, displayScale, project.resolution.workingWidth, project.resolution.workingHeight, setView]
  );

  // ----- Keyboard: Z to temporarily pan, [ ] to adjust brush radius -----
  // Z is held down to enter pan mode: drag pans the canvas, and releasing Z
  // restores the previously active tool. The brush radius is now adjusted
  // with [ (smaller) and ] (larger) since the mouse wheel is reserved for
  // zoom-to-cursor.

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore typing in inputs
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Ctrl+Z (or Cmd+Z on Mac) = undo. Ctrl+Shift+Z / Ctrl+Y = redo.
      // We handle these BEFORE the Z pan-mode check so that Ctrl+Z doesn't
      // accidentally trigger pan mode.
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        redo();
        e.preventDefault();
        return;
      }
      // "Z" key — temporarily enter pan mode (don't repeat-fire on hold).
      // IMPORTANT: ignore Z when Ctrl/Cmd is held so that Ctrl+Z (undo) and
      // Ctrl+Shift+Z (redo) work as expected instead of triggering pan mode.
      if ((e.key === "z" || e.key === "Z") && !e.repeat && !e.ctrlKey && !e.metaKey) {
        enterPanMode("z");
        e.preventDefault();
        return;
      }
      // " " (Space) — temporarily enter pan mode. A SHORT tap without a
      // drag toggles play/pause on release (handled in onKeyUp).
      if (e.key === " " && !e.repeat) {
        spacePressedAtRef.current = performance.now();
        spaceDragOccurredRef.current = false;
        enterPanMode("space");
        e.preventDefault();
        return;
      }
      // "[" / "]" — adjust the active tool's primary radius.
      //   - In deform mode: deform brush radius (8..400, step 8)
      //   - In blob mode: blob brush radius (4..120, step 2)
      // No-op in other modes. We read the latest brush state via
      // `useRotoStore.getState()` so that rapid key repeats (which fire before
      // the effect re-runs and re-binds the handler) accumulate correctly.
      if (e.key === "[") {
        const cur = useRotoStore.getState().brush;
        if (cur.mode === "deform") {
          useRotoStore
            .getState()
            .setBrush({ deformRadius: Math.max(8, cur.deformRadius - 8) });
          e.preventDefault();
        } else if (cur.mode === "blob") {
          useRotoStore
            .getState()
            .setBrush({ blobBrushRadius: Math.max(4, cur.blobBrushRadius - 2) });
          e.preventDefault();
        }
        return;
      }
      if (e.key === "]") {
        const cur = useRotoStore.getState().brush;
        if (cur.mode === "deform") {
          useRotoStore
            .getState()
            .setBrush({ deformRadius: Math.min(400, cur.deformRadius + 8) });
          e.preventDefault();
        } else if (cur.mode === "blob") {
          useRotoStore
            .getState()
            .setBrush({ blobBrushRadius: Math.min(120, cur.blobBrushRadius + 2) });
          e.preventDefault();
        }
        return;
      }
      // "0" key — reset view to fit.
      if (e.key === "0") {
        resetView();
        e.preventDefault();
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "z" || e.key === "Z") {
        exitPanMode();
        // Also terminate any in-progress pan drag.
        panDragRef.current = null;
        return;
      }
      if (e.key === " ") {
        const wasTap =
          !spaceDragOccurredRef.current &&
          performance.now() - spacePressedAtRef.current < SPACE_TAP_MAX_MS;
        exitPanMode();
        panDragRef.current = null;
        if (wasTap) {
          // Space TAP — toggle play/pause by clicking the Timeline's
          // Play/Pause button. The button is identified by its aria-label
          // ("Play" or "Pause" depending on the current state).
          const btn = Array.from(
            document.querySelectorAll(
              'button[aria-label="Play"], button[aria-label="Pause"]'
            )
          )[0] as HTMLButtonElement | undefined;
          if (btn) btn.click();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enterPanMode, exitPanMode, resetView, undo, redo]);

  // ----- Render loop -----

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Lazily create the offscreen video-frame cache canvas.
    if (!videoFrameCacheRef.current) {
      videoFrameCacheRef.current = document.createElement("canvas");
    }
    drawFrame(ctx, canvas, {
      project,
      onion,
      selectedShapeIds,
      selectedNode,
      drawing: drawingRef.current,
      deforming: deformingRef.current,
      selecting: selectingRef.current,
      video: videoRef.current,
      displayScale,
      mode: brush.mode,
      brushRadius:
        brush.mode === "blob"
          ? brush.blobBrushRadius
          : brush.deformRadius,
      videoFrameCache: videoFrameCacheRef.current,
      videoSeeking: videoSeekingRef.current,
    });
  }, [
    project,
    onion,
    selectedShapeIds,
    selectedNode,
    brush.mode,
    brush.blobBrushRadius,
    brush.deformRadius,
    displayScale,
    videoRef,
  ]);

  // Also redraw continuously while drawing/deforming (animation frame loop)
  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        if (!videoFrameCacheRef.current) {
          videoFrameCacheRef.current = document.createElement("canvas");
        }
        drawFrame(ctx, canvas, {
          project,
          onion,
          selectedShapeIds,
          selectedNode,
          drawing: drawingRef.current,
          deforming: deformingRef.current,
          selecting: selectingRef.current,
          video: videoRef.current,
          displayScale,
          mode: brush.mode,
          brushRadius:
            brush.mode === "blob"
              ? brush.blobBrushRadius
              : brush.deformRadius,
          videoFrameCache: videoFrameCacheRef.current,
          videoSeeking: videoSeekingRef.current,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [
    project,
    onion,
    selectedShapeIds,
    selectedNode,
    brush.mode,
    brush.blobBrushRadius,
    brush.deformRadius,
    displayScale,
    videoRef,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-neutral-900"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
      onMouseEnter={() => setCursorOverCanvas(true)}
      onMouseLeave={() => {
        setCursorOverCanvas(false);
        setCursor(null);
      }}
    >
      <canvas
        ref={canvasRef}
        width={project.resolution.workingWidth}
        height={project.resolution.workingHeight}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        className="bg-black shadow-2xl rounded"
        style={{
          width: project.resolution.workingWidth * displayScale,
          height: project.resolution.workingHeight * displayScale,
          // Apply zoom + pan via CSS transform. The canvas's intrinsic pixel
          // size stays at workingWidth × workingHeight (no re-rasterization
          // needed on zoom/pan). The transform-origin is set to top-left so
          // that pan offsets compose intuitively with the scale.
          transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          transformOrigin: "top left",
          cursor:
            panModePreviousTool !== null
              ? "grab"
              : brush.mode === "deform"
              ? "none"
              : brush.mode === "node"
              ? "default"
              : brush.mode === "select"
              ? "default"
              : "crosshair",
          imageRendering: "pixelated",
        }}
      />
      {cursor && cursorOverCanvas && brush.mode === "deform" && (
        <BrushCursor
          x={canvasBase.left + cursor.x * displayScale * view.zoom + view.panX}
          y={canvasBase.top + cursor.y * displayScale * view.zoom + view.panY}
          radius={brush.deformRadius * displayScale * view.zoom}
          strength={brush.deformStrength}
        />
      )}
      {cursor && cursorOverCanvas && brush.mode === "blob" && (
        <BlobCursor
          x={canvasBase.left + cursor.x * displayScale * view.zoom + view.panX}
          y={canvasBase.top + cursor.y * displayScale * view.zoom + view.panY}
          radius={brush.blobBrushRadius * displayScale * view.zoom}
        />
      )}
    </div>
  );
}

/** Compact brush ring for the Blob tool — shows the brush's footprint radius. */
function BlobCursor({ x, y, radius }: { x: number; y: number; radius: number }) {
  const size = Math.max(12, radius * 2 + 4);
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-full border-2 border-amber-300/80 bg-amber-300/10"
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
      }}
    />
  );
}

// ============================================================
// Drawing pipeline
// ============================================================

interface DrawArgs {
  project: ReturnType<typeof useRotoStore.getState>["project"];
  onion: ReturnType<typeof useRotoStore.getState>["onion"];
  selectedShapeIds: string[];
  selectedNode: { shapeId: string; nodeIndex: number } | null;
  drawing: LiveStroke | null;
  deforming: { shapeId: string; scope: "local" | "global" } | null;
  selecting: { start: Vec2; marquee: Vec2 | null } | null;
  video: HTMLVideoElement | null;
  displayScale: number;
  mode: ToolMode;
  brushRadius: number;       // for blob/deform live preview
  /**
   * Offscreen canvas that caches the last successfully drawn video frame.
   * When the video is mid-seek (or otherwise not ready), we draw the cached
   * frame instead of clearing to black — this prevents the "alternating black
   * frame" flicker the user observed during playback.
   */
  videoFrameCache: HTMLCanvasElement | null;
  /** True when the <video> element is mid-seek. */
  videoSeeking: boolean;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  args: DrawArgs
) {
  const { project, onion, selectedShapeIds, selectedNode, drawing, selecting, video, mode, brushRadius, videoFrameCache, videoSeeking } = args;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // --- Background: current video frame.
  // Strategy: try to draw the live video frame. If the video is mid-seek
  // (videoSeeking === true) OR drawImage throws, fall back to the cached
  // frame. If no cache exists yet, fall back to a dark fill. When we
  // successfully draw a fresh video frame, we also write it into the cache
  // so it's available for the next seek.
  let drewVideo = false;
  if (video && video.readyState >= 2 && !videoSeeking) {
    try {
      ctx.drawImage(
        video,
        0,
        0,
        video.videoWidth,
        video.videoHeight,
        0,
        0,
        project.resolution.workingWidth,
        project.resolution.workingHeight
      );
      drewVideo = true;
      // Cache this frame for fallback during the next seek.
      if (videoFrameCache) {
        const cctx = videoFrameCache.getContext("2d");
        if (cctx) {
          // Only resize the cache if dimensions changed.
          if (
            videoFrameCache.width !== project.resolution.workingWidth ||
            videoFrameCache.height !== project.resolution.workingHeight
          ) {
            videoFrameCache.width = project.resolution.workingWidth;
            videoFrameCache.height = project.resolution.workingHeight;
          }
          cctx.drawImage(
            video,
            0,
            0,
            video.videoWidth,
            video.videoHeight,
            0,
            0,
            project.resolution.workingWidth,
            project.resolution.workingHeight
          );
        }
      }
    } catch {
      // drawImage can throw on cross-origin, but blob URLs are same-origin.
      // Fall through to the cache fallback below.
    }
  }
  if (!drewVideo) {
    // Fall back to the cached video frame if available.
    if (videoFrameCache && videoFrameCache.width > 0 && videoFrameCache.height > 0) {
      ctx.drawImage(
        videoFrameCache,
        0,
        0,
        videoFrameCache.width,
        videoFrameCache.height,
        0,
        0,
        project.resolution.workingWidth,
        project.resolution.workingHeight
      );
    } else {
      // No cache yet — dark fill as a last resort.
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // --- Onion skinning: ghost prev/next frames
  if (onion.enabled) {
    for (let i = 1; i <= onion.previousFrames; i++) {
      const idx = project.currentFrame - i;
      if (idx < 0) break;
      const opacity = onion.opacityStep * (onion.previousFrames - i + 1);
      drawAllLayersForFrame(ctx, project, idx, opacity, "red");
    }
    for (let i = 1; i <= onion.nextFrames; i++) {
      const idx = project.currentFrame + i;
      if (idx >= project.frameCount) break;
      const opacity = onion.opacityStep * (onion.nextFrames - i + 1);
      drawAllLayersForFrame(ctx, project, idx, opacity, "green");
    }
  }

  // --- Current frame vector shapes
  drawAllLayersForFrame(ctx, project, project.currentFrame, 1, null);

  // --- Live drawing preview
  if (drawing && drawing.points.length > 1) {
    ctx.save();
    if (mode === "blob") {
      // Render the blob stroke as a thick filled ribbon (live preview only —
      // the final merged polygon is computed on mouseup).
      ctx.strokeStyle = args.brushRadius > 0 ? "rgba(0,0,0,0.8)" : "#000";
      ctx.lineWidth = args.brushRadius * 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
      for (let i = 1; i < drawing.points.length; i++) {
        ctx.lineTo(drawing.points[i].x, drawing.points[i].y);
      }
      ctx.stroke();
    } else if (mode === "knife") {
      // Render the knife cut path as a dashed red line so it's clearly
      // distinguishable from the underlying shape outlines.
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
      for (let i = 1; i < drawing.points.length; i++) {
        ctx.lineTo(drawing.points[i].x, drawing.points[i].y);
      }
      ctx.stroke();
      // Close the cut with a faint dashed line back to start, to visualize
      // what will be subtracted.
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(239,68,68,0.4)";
      ctx.lineTo(drawing.points[0].x, drawing.points[0].y);
      ctx.stroke();
    } else {
      // Standard draw mode: simple thin black stroke preview.
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(drawing.points[0].x, drawing.points[0].y);
      for (let i = 1; i < drawing.points.length; i++) {
        ctx.lineTo(drawing.points[i].x, drawing.points[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Selection overlays (bounding box for select tool, nodes for node tool)
  if (selectedShapeIds.length > 0) {
    ctx.save();
    if (mode === "node") {
      // Render each selected shape's nodes as small circles.
      for (const layer of project.layers) {
        if (!layer.visible) continue;
        for (const sub of layer.subLayers) {
          if (!sub.visible) continue;
          const shapes = getInterpolatedShapesForFrame(
            project,
            project.currentFrame,
            sub.id
          );
          for (const sh of shapes) {
            if (!selectedShapeIds.includes(sh.id)) continue;
            // Outline the shape in a highlighted yellow.
            ctx.strokeStyle = "#ffeb3b";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            if (sh.points.length > 0) {
              ctx.moveTo(sh.points[0].x, sh.points[0].y);
              for (let i = 1; i < sh.points.length; i++) {
                ctx.lineTo(sh.points[i].x, sh.points[i].y);
              }
              if (sh.fill.closed) ctx.closePath();
            }
            ctx.stroke();
            // Draw nodes.
            for (let i = 0; i < sh.points.length; i++) {
              const p = sh.points[i];
              const isSelectedNode =
                selectedNode?.shapeId === sh.id && selectedNode?.nodeIndex === i;
              ctx.beginPath();
              ctx.arc(p.x, p.y, isSelectedNode ? 5 : 4, 0, Math.PI * 2);
              ctx.fillStyle = isSelectedNode ? "#ffeb3b" : "#ffffff";
              ctx.fill();
              ctx.strokeStyle = isSelectedNode ? "#000" : "#444";
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          }
        }
      }
    } else {
      // Default selection: bounding-box rectangle.
      ctx.strokeStyle = "#ffeb3b";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      for (const layer of project.layers) {
        if (!layer.visible) continue;
        for (const sub of layer.subLayers) {
          if (!sub.visible) continue;
          const shapes = getInterpolatedShapesForFrame(
            project,
            project.currentFrame,
            sub.id
          );
          for (const sh of shapes) {
            if (!selectedShapeIds.includes(sh.id)) continue;
            const bb = shapeBBox(sh.points);
            ctx.strokeRect(
              bb.minX - 4,
              bb.minY - 4,
              bb.maxX - bb.minX + 8,
              bb.maxY - bb.minY + 8
            );
          }
        }
      }
    }
    ctx.restore();
  }

  // --- Marquee selection rectangle
  if (selecting && selecting.marquee) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 235, 59, 0.1)";
    ctx.strokeStyle = "rgba(255, 235, 59, 0.9)";
    ctx.lineWidth = 1;
    const x = Math.min(selecting.start.x, selecting.marquee.x);
    const y = Math.min(selecting.start.y, selecting.marquee.y);
    const w = Math.abs(selecting.marquee.x - selecting.start.x);
    const h = Math.abs(selecting.marquee.y - selecting.start.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

function drawAllLayersForFrame(
  ctx: CanvasRenderingContext2D,
  project: ReturnType<typeof useRotoStore.getState>["project"],
  frameIndex: number,
  opacity: number,
  tint: "red" | "green" | null
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  for (const layer of project.layers) {
    if (!layer.visible) continue;
    for (const sub of layer.subLayers) {
      if (!sub.visible) continue;
      const shapes = getInterpolatedShapesForFrame(project, frameIndex, sub.id);
      for (const sh of shapes) {
        drawShape(ctx, sh, tint);
      }
    }
  }
  ctx.restore();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: VectorShape,
  tint: "red" | "green" | null
) {
  if (shape.points.length < 2) return;
  const lineBoil = shape.stroke.jitter > 0 ? shape.stroke.jitter * 2 : 0;
  const pts = lineBoil > 0
    ? applyLineBoil(shape.points, shape.seed, lineBoil)
    : shape.points;
  ctx.save();
  // Fill first
  if (shape.fill.enabled && shape.fill.closed) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const cur = pts[i];
      const next = pts[i + 1];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.closePath();
    ctx.fillStyle = tint === "red" ? "#ff4d4d" : tint === "green" ? "#4dff7a" : shape.fill.color;
    ctx.fill();
  }
  // Stroke (only if enabled)
  if (shape.stroke.enabled) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const cur = pts[i];
      const next = pts[i + 1];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    if (shape.fill.closed) ctx.closePath();
    ctx.strokeStyle = tint === "red" ? "#ff4d4d" : tint === "green" ? "#4dff7a" : shape.stroke.color;
    ctx.lineWidth = shape.stroke.width * (1 + shape.stroke.variance * (Math.random() - 0.5));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

// ============================================================
// Helpers
// ============================================================

function simplifyPoints(points: Vec2[], threshold: number): Vec2[] {
  if (points.length < 3) return points;
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(points[i].x - prev.x, points[i].y - prev.y) >= threshold) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
