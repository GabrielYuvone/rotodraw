"use client";

import {
  useRotoStore,
  getActiveSubLayer,
  getInterpolatedShapesForFrame,
  hasDrawingBreak,
  getDrawingBreaks,
} from "@/lib/roto/store";
import type { VectorShape } from "@/lib/roto/types";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Diamond,
  Layers,
  Frame as FrameIcon,
  Activity,
  Info,
  Trash2,
  Palette,
  Unlink,
} from "lucide-react";

export function PropertiesPanel() {
  const project = useRotoStore((s) => s.project);
  const brush = useRotoStore((s) => s.brush);
  const selectedShapeIds = useRotoStore((s) => s.selectedShapeIds);
  const setShapeFillColor = useRotoStore((s) => s.setShapeFillColor);
  const deleteShape = useRotoStore((s) => s.deleteShape);
  const toggleDrawingBreak = useRotoStore((s) => s.toggleDrawingBreak);
  const subLayer = getActiveSubLayer(project);
  const currentFrameObj = project.frames[project.currentFrame];
  const currentFrame = project.currentFrame;
  const breaksForActive =
    subLayer != null ? getDrawingBreaks(project, subLayer.id) : [];
  const hasBreakAtCurrent =
    subLayer != null && hasDrawingBreak(project, subLayer.id, currentFrame);
  const shapeCount = subLayer
    ? getInterpolatedShapesForFrame(
        project,
        project.currentFrame,
        subLayer.id
      ).length
    : 0;

  // Find the first selected shape and the sub-layer it belongs to.
  let selectedShapeInfo: { subLayerId: string; shape: VectorShape } | null =
    null;
  if (selectedShapeIds.length > 0) {
    for (const layer of project.layers) {
      for (const sub of layer.subLayers) {
        const shapes = getInterpolatedShapesForFrame(
          project,
          project.currentFrame,
          sub.id
        );
        const sh = shapes.find((s) => selectedShapeIds.includes(s.id));
        if (sh) {
          selectedShapeInfo = { subLayerId: sub.id, shape: sh };
          break;
        }
      }
      if (selectedShapeInfo) break;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 py-2 border-b">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" /> Properties
        </h3>
      </div>
      <ScrollArea className="flex-1 max-h-[calc(100vh-220px)]">
        <div className="p-3 space-y-4 text-sm">
          {/* Active sub-layer info */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Active Sub-layer
            </h4>
            {subLayer ? (
              <div className="rounded-md border bg-card/60 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{subLayer.name}</span>
                  <Badge variant="secondary" className="capitalize">
                    {subLayer.kind}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  <span>{shapeCount} shape{shapeCount !== 1 ? "s" : ""}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No sub-layer active. Click a sub-layer in the layer manager to start drawing.
              </p>
            )}
          </section>

          <Separator />

          {/* Current frame info */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Current Frame
            </h4>
            <div className="rounded-md border bg-card/60 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Index</span>
                <span className="font-mono text-sm">
                  {project.currentFrame + 1} / {project.frameCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Keyframe</span>
                <span className="flex items-center gap-1.5 text-sm">
                  {currentFrameObj?.isKeyframe ? (
                    <>
                      <Diamond className="h-3 w-3 fill-primary text-primary" />
                      <span className="text-primary">Yes</span>
                    </>
                  ) : (
                    <>
                      <Diamond className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">In-between</span>
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Time</span>
                <span className="font-mono text-sm">
                  {(project.currentFrame / project.fps).toFixed(3)}s
                </span>
              </div>
            </div>
          </section>

          <Separator />

          {/* Selected shape info — fill color picker & delete */}
          {selectedShapeInfo && (
            <section>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                <Palette className="h-3 w-3" /> Selected Shape
              </h4>
              <div className="rounded-md border bg-card/60 p-3 space-y-2 text-xs">
                <Row
                  label="ID"
                  value={selectedShapeInfo.shape.id.slice(-8)}
                />
                <Row
                  label="Nodes"
                  value={`${selectedShapeInfo.shape.points.length}`}
                />
                <Row
                  label="Closed"
                  value={selectedShapeInfo.shape.fill.closed ? "Yes" : "No"}
                />
                {/* Fill color picker */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Fill color</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">
                      {selectedShapeInfo.shape.fill.color}
                    </span>
                    <input
                      type="color"
                      value={selectedShapeInfo.shape.fill.color}
                      onChange={(e) =>
                        setShapeFillColor(
                          selectedShapeInfo.subLayerId,
                          selectedShapeInfo.shape.id,
                          e.target.value
                        )
                      }
                      className="h-6 w-8 rounded border border-input bg-background cursor-pointer"
                      aria-label="Change fill color"
                    />
                  </div>
                </div>
                {/* Quick color presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-muted-foreground">Presets:</span>
                  {[
                    "#1f3a5f", // Sombra Oscura (dark blue)
                    "#3b6fb5", // Pleno Azul (medium blue)
                    "#88b4e8", // Detalle Claro (light blue)
                    "#7c4d2a", // Sombra Piel
                    "#e8b87a", // Pleno Piel
                    "#fbe5c8", // Highlight skin
                    "#000000",
                    "#ffffff",
                  ].map((c) => (
                    <button
                      key={c}
                      onClick={() =>
                        setShapeFillColor(
                          selectedShapeInfo.subLayerId,
                          selectedShapeInfo.shape.id,
                          c
                        )
                      }
                      className="h-4 w-4 rounded-sm border border-input hover:scale-125 transition-transform"
                      style={{ background: c }}
                      aria-label={`Set fill to ${c}`}
                    />
                  ))}
                </div>
                {/* Delete button */}
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full h-7 text-xs"
                  onClick={() =>
                    deleteShape(
                      selectedShapeInfo.subLayerId,
                      selectedShapeInfo.shape.id
                    )
                  }
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Delete shape (Del)
                </Button>
                <p className="text-[10px] text-muted-foreground">
                  Tip: Switch to <strong>Node</strong> tool to edit individual
                  points, or <strong>Knife</strong> tool to slice this shape
                  into independent pieces.
                </p>
              </div>
            </section>
          )}

          <Separator />

          {/* Active tool info */}
          {brush.mode === "deform" && (
            <section>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
                <Activity className="h-3 w-3" /> Deform Scope
              </h4>
              <div className="rounded-md border bg-card/60 p-3 text-xs space-y-1.5">
                <Row
                  label="Mode"
                  value={
                    brush.deformScope === "global" ? "Global" : "Local"
                  }
                />
                <p className="text-muted-foreground">
                  {brush.deformScope === "global"
                    ? "Deforms ALL sub-layers in the parent layer within the brush radius. Use this to move the entire Cara (eyes, mouth, outlines) together."
                    : "Deforms only the specific shape under the cursor. Use this to tweak individual cels (e.g., a single shadow shape) without affecting neighbors."}
                </p>
              </div>
            </section>
          )}

          <Separator />

          {/* Frame rate / resolution summary */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Project
            </h4>
            <div className="rounded-md border bg-card/60 p-3 space-y-1.5">
              <Row label="Working FPS" value={`${project.fps}`} />
              <Row
                label="Canvas"
                value={`${project.resolution.workingWidth}×${project.resolution.workingHeight}`}
              />
              <Row label="Source" value={`${project.resolution.sourceWidth}×${project.resolution.sourceHeight}`} />
              <Row label="Total Frames" value={`${project.frameCount}`} />
              <Row label="Layers" value={`${project.layers.length}`} />
            </div>
          </section>

          <Separator />

          {/* Keyframe interpolation status */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <Activity className="h-3 w-3" /> Tweening Status
            </h4>
            <div className="rounded-md border bg-card/60 p-3 text-xs space-y-2">
              {subLayer ? (
                <TweenStatus subLayerId={subLayer.id} />
              ) : (
                <p className="text-muted-foreground">
                  Activate a sub-layer to see tweening info.
                </p>
              )}
            </div>
          </section>

          <Separator />

          {/* Drawing Substitutions (breaks) — multiple independent drawings
              within the same sub-layer. */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <Unlink className="h-3 w-3" /> Drawing Substitutions
            </h4>
            <div className="rounded-md border bg-card/60 p-3 text-xs space-y-2">
              {subLayer ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Break at frame {currentFrame + 1}
                    </span>
                    <span
                      className={
                        hasBreakAtCurrent
                          ? "text-red-500 font-medium"
                          : "text-muted-foreground"
                      }
                    >
                      {hasBreakAtCurrent ? "Yes — fresh drawing starts here" : "No"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Total breaks in this sub-layer
                    </span>
                    <span className="font-mono text-sm">
                      {breaksForActive.length}
                    </span>
                  </div>
                  {breaksForActive.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">At frames:</span>
                      {breaksForActive.map((b) => (
                        <button
                          key={b}
                          onClick={() =>
                            useRotoStore.getState().setCurrentFrame(b)
                          }
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border
                            ${
                              b === currentFrame
                                ? "bg-red-500/15 border-red-500 text-red-500"
                                : "border-border bg-card hover:bg-accent"
                            }`}
                          title={`Jump to frame ${b + 1}`}
                        >
                          {b + 1}
                        </button>
                      ))}
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant={hasBreakAtCurrent ? "destructive" : "outline"}
                    className="w-full h-7 text-xs"
                    onClick={() =>
                      toggleDrawingBreak(subLayer.id, currentFrame)
                    }
                  >
                    <Unlink className="h-3 w-3 mr-1" />
                    {hasBreakAtCurrent
                      ? "Remove Drawing Break"
                      : "Insert Drawing Break"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Use a drawing break when a character turns drastically
                    (e.g., front → profile). The previous drawing stops
                    interpolating, and you start a fresh shape on this frame
                    — all layer styles (stroke, fill) are preserved. Press
                    <kbd className="mx-0.5 px-1 py-0.5 rounded bg-muted border border-border text-[9px]">B</kbd>
                    as a shortcut.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Activate a sub-layer to manage drawing breaks.
                </p>
              )}
            </div>
          </section>

          <Separator />

          {/* Quick tips */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <FrameIcon className="h-3 w-3" /> Quick Tips
            </h4>
            <ul className="text-xs space-y-1 text-muted-foreground list-disc list-inside">
              <li><strong>Draw</strong> on a keyframe, then jump ahead & draw again to create a tween.</li>
              <li><strong>Blob Brush</strong>: same-color strokes auto-merge into one solid fill — perfect for cel-shading blocks.</li>
              <li><strong>Knife</strong>: draw across a closed shape to slice it into independent pieces.</li>
              <li><strong>Node</strong>: click a shape to reveal control points; drag a node to move; Delete to remove.</li>
              <li><strong>Drawing Break</strong> (<kbd>B</kbd>): insert at a turn frame to stop the previous drawing from interpolating and start a fresh shape in the same sub-layer.</li>
              <li><strong>Deform (Local)</strong>: push only the sub-layer under cursor.</li>
              <li><strong>Deform (Global)</strong>: push the entire parent layer (eyes + mouth + outlines) together.</li>
              <li>Hold <kbd>Shift</kbd> while dragging in Select mode to scale; <kbd>Alt</kbd> to rotate.</li>
              <li><kbd>Scroll wheel</kbd> zooms in/out at the cursor · <kbd>Z</kbd> + drag pans · release Z to return to your tool · <kbd>0</kbd> resets the view.</li>
              <li><kbd>Space</kbd> + drag also pans; a quick <kbd>Space</kbd> tap toggles play/pause.</li>
              <li>Use <kbd>[</kbd> / <kbd>]</kbd> to adjust the Deform / Blob brush radius (the wheel is reserved for zoom).</li>
              <li><strong>Smoothing</strong>: in Draw / Blob mode, raise the Smoothing slider (0–5) for cleaner, more elegant curves from raw hand input.</li>
              <li><strong>Deform</strong>: drag with the brush to nudge points toward where you started — points follow the cursor proportional to strength × falloff, with no compounding.</li>
              <li><strong>Optical Flow (Vector-EbSynth)</strong>: toggle the ⚡ switch in the timeline, set flow strength, then click "Propagate →" to shift vector nodes forward across frames following the video's motion. Pause at any frame to manually correct — the corrected frame becomes the new ground truth. Click Propagate again to resume from there.</li>
              <li><strong>Rotoshop Control Loop</strong>: <kbd>Space</kbd> tap = play/pause · scrub the slider to any frame · draw/deform to correct · the corrected frame auto-promotes to keyframe · resume playback propagates from the corrected state.</li>
              <li><strong>Playback speed</strong>: use the 0.25× / 0.5× / 1× / 2× buttons in the timeline for fine-grained review.</li>
            </ul>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function TweenStatus({ subLayerId }: { subLayerId: string }) {
  const project = useRotoStore((s) => s.project);
  const idx = project.currentFrame;
  const breaks = getDrawingBreaks(project, subLayerId);
  // Compute the drawing span [spanStart, spanEnd) for the current frame.
  let spanStart = 0;
  let spanStartsAtBreak = false;
  let spanEnd = project.frameCount;
  for (const b of breaks) {
    if (b <= idx) {
      spanStart = b;
      spanStartsAtBreak = true;
    } else if (b > idx && b < spanEnd) {
      spanEnd = b;
    }
  }
  // Find prev / next keyframe WITHIN the current drawing span.
  let prevKf: number | null = null;
  let nextKf: number | null = null;
  for (let i = idx; i >= spanStart; i--) {
    const f = project.frames[i];
    if (f?.isKeyframe && f.states[subLayerId]) {
      prevKf = i;
      break;
    }
  }
  for (let i = idx + 1; i < spanEnd; i++) {
    const f = project.frames[i];
    if (f?.isKeyframe && f.states[subLayerId]) {
      nextKf = i;
      break;
    }
  }

  const currentFrameObj = project.frames[idx];
  if (currentFrameObj?.isKeyframe && currentFrameObj.states[subLayerId]) {
    return (
      <p className="text-foreground">
        This frame holds a keyframe with{" "}
        <span className="font-mono">{currentFrameObj.states[subLayerId].length}</span>{" "}
        shape(s) for the active sub-layer.
      </p>
    );
  }
  if (prevKf !== null && nextKf !== null && prevKf !== nextKf) {
    const span = nextKf - prevKf;
    const t = (idx - prevKf) / span;
    return (
      <p>
        In-betweening from KF#{prevKf + 1} → KF#{nextKf + 1} at{" "}
        <span className="font-mono">{Math.round(t * 100)}%</span>.
        Lines and fills are interpolated linearly between the two keyframes
        within the current drawing span.
      </p>
    );
  }
  if (prevKf !== null) {
    return (
      <p>
        Holding from previous KF#{prevKf + 1}. Add a future keyframe in this
        span to tween.{" "}
        {spanEnd < project.frameCount && (
          <span className="text-red-500">
            (A drawing break at frame {spanEnd + 1} stops this span.)
          </span>
        )}
      </p>
    );
  }
  if (spanStartsAtBreak) {
    return (
      <p>
        <span className="text-red-500 font-medium">Blank.</span> This frame is
        in a new drawing span (break at frame {spanStart + 1}) with no
        keyframe yet. Draw on this frame to start the new drawing.
      </p>
    );
  }
  if (nextKf !== null) {
    return <p>Holding backward from next KF#{nextKf + 1}.</p>;
  }
  return <p>No keyframes for this sub-layer yet. Draw on this frame to create one.</p>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  );
}
