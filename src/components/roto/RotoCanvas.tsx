"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRotoStore, getInterpolatedShapesForFrame } from "@/lib/roto/store";
import type { Vec2, VectorShape, Layer, SubLayer } from "@/lib/roto/types";
import {
  applyLineBoil,
  distanceToShape,
  shapeBBox,
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
  const liveDeformShape = useRotoStore((s) => s.liveDeformShape);
  const liveTransformShapes = useRotoStore((s) => s.liveTransformShapes);
  const selectShapes = useRotoStore((s) => s.selectShapes);
  const clearSelection = useRotoStore((s) => s.clearSelection);
  const setBrush = useRotoStore((s) => s.setBrush);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [displayScale, setDisplayScale] = useState(1);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [cursorOverCanvas, setCursorOverCanvas] = useState(false);

  // Live drawing/deforming state (refs to avoid re-renders on every mouse move)
  const drawingRef = useRef<LiveStroke | null>(null);
  const deformingRef = useRef<{
    subLayerId: string;
    shapeId: string;
    startMouse: Vec2;
    lastMouse: Vec2;
  } | null>(null);
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

  // ----- Display scale: fit canvas into container -----

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onResize = () => {
      const cw = container.clientWidth - 24;
      const ch = container.clientHeight - 24;
      const sw = project.resolution.workingWidth;
      const sh = project.resolution.workingHeight;
      const scale = Math.min(cw / sw, ch / sh, 2);
      setDisplayScale(scale);
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
          }
        }
      }
      return null;
    },
    [project]
  );

  // ----- Pointer event handlers -----

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 2) return; // right-click ignored
      const p = toCanvasCoords(e);
      const mode = brush.mode;
      const activeSubLayerId = project.activeSubLayerId;

      if (mode === "draw") {
        if (!activeSubLayerId) return;
        drawingRef.current = {
          subLayerId: activeSubLayerId,
          points: [p],
        };
      } else if (mode === "deform") {
        const hit = findShapeAt(p);
        if (!hit) return;
        deformingRef.current = {
          subLayerId: hit.subLayer.id,
          shapeId: hit.shape.id,
          startMouse: p,
          lastMouse: p,
        };
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
      project,
      findShapeAt,
      selectedShapeIds,
      selectShapes,
      clearSelection,
      toCanvasCoords,
    ]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
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

      // Deforming — push/pull points within radius around cursor
      if (deformingRef.current) {
        const d = deformingRef.current;
        const dx = p.x - d.lastMouse.x;
        const dy = p.y - d.lastMouse.y;
        const r = brush.deformRadius;
        const strength = brush.deformStrength;
        liveDeformShape(d.subLayerId, d.shapeId, (pts) =>
          pts.map((pt) => {
            const ddx = pt.x - d.lastMouse.x;
            const ddy = pt.y - d.lastMouse.y;
            const dist2val = ddx * ddx + ddy * ddy;
            if (dist2val > r * r) return pt;
            // Falloff: linear with distance, 1 at center, 0 at radius
            const falloff = 1 - Math.sqrt(dist2val) / r;
            return {
              x: pt.x + dx * strength * falloff,
              y: pt.y + dy * strength * falloff,
            };
          })
        );
        d.lastMouse = p;
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
    [brush.deformRadius, brush.deformStrength, liveDeformShape, liveTransformShapes, toCanvasCoords]
  );

  const onMouseUp = useCallback(() => {
    // Finalize drawing
    if (drawingRef.current) {
      const d = drawingRef.current;
      const pts = simplifyPoints(d.points, 2);
      if (pts.length >= 2) {
        const newShape: VectorShape = {
          id: uid("shape"),
          points: pts,
          stroke: {
            color: "#000000", // black comic outline by default
            width: brush.drawStrokeWidth,
            jitter: brush.drawStrokeJitter,
            variance: brush.drawStrokeVariance,
          },
          fill: {
            enabled: true,
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
    selectShapes,
  ]);

  // ----- Mouse wheel: adjust deform radius -----

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (brush.mode === "deform") {
        e.preventDefault?.();
        const delta = -Math.sign(e.deltaY) * 8;
        const next = Math.max(8, Math.min(400, brush.deformRadius + delta));
        setBrush({ deformRadius: next });
      }
    },
    [brush.mode, brush.deformRadius, setBrush]
  );

  // ----- Render loop -----

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFrame(ctx, canvas, {
      project,
      onion,
      selectedShapeIds,
      drawing: drawingRef.current,
      deforming: deformingRef.current,
      selecting: selectingRef.current,
      video: videoRef.current,
      displayScale,
    });
  }, [
    project,
    onion,
    selectedShapeIds,
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
        drawFrame(ctx, canvas, {
          project,
          onion,
          selectedShapeIds,
          drawing: drawingRef.current,
          deforming: deformingRef.current,
          selecting: selectingRef.current,
          video: videoRef.current,
          displayScale,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [project, onion, selectedShapeIds, displayScale, videoRef]);

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
          cursor: brush.mode === "deform" ? "none" : brush.mode === "select" ? "default" : "crosshair",
          imageRendering: "pixelated",
        }}
      />
      {cursor && cursorOverCanvas && brush.mode === "deform" && (
        <BrushCursor
          x={cursor.x * displayScale}
          y={cursor.y * displayScale}
          radius={brush.deformRadius * displayScale}
          strength={brush.deformStrength}
        />
      )}
    </div>
  );
}

// ============================================================
// Drawing pipeline
// ============================================================

interface DrawArgs {
  project: ReturnType<typeof useRotoStore.getState>["project"];
  onion: ReturnType<typeof useRotoStore.getState>["onion"];
  selectedShapeIds: string[];
  drawing: LiveStroke | null;
  deforming: { shapeId: string } | null;
  selecting: { start: Vec2; marquee: Vec2 | null } | null;
  video: HTMLVideoElement | null;
  displayScale: number;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  args: DrawArgs
) {
  const { project, onion, selectedShapeIds, drawing, selecting, video } = args;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // --- Background: current video frame (if video element available & ready)
  if (video && video.readyState >= 2) {
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
    } catch {
      // ignore — drawImage can throw on cross-origin, but blob URLs are same-origin
    }
  } else {
    // Fallback checkerboard
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    ctx.restore();
  }

  // --- Selection overlays
  if (selectedShapeIds.length > 0) {
    ctx.save();
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
          ctx.strokeRect(bb.minX - 4, bb.minY - 4, bb.maxX - bb.minX + 8, bb.maxY - bb.minY + 8);
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
  // Stroke
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
