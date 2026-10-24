"use client";

import { useRotoStore, getActiveSubLayer, getInterpolatedShapesForFrame } from "@/lib/roto/store";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Diamond,
  Layers,
  Frame as FrameIcon,
  Activity,
  Info,
} from "lucide-react";

export function PropertiesPanel() {
  const project = useRotoStore((s) => s.project);
  const subLayer = getActiveSubLayer(project);
  const currentFrameObj = project.frames[project.currentFrame];
  const shapeCount = subLayer
    ? getInterpolatedShapesForFrame(project, project.currentFrame, subLayer.id).length
    : 0;

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

          {/* Quick tips */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
              <FrameIcon className="h-3 w-3" /> Quick Tips
            </h4>
            <ul className="text-xs space-y-1 text-muted-foreground list-disc list-inside">
              <li>Draw on a keyframe, then jump ahead & draw again to create a tween.</li>
              <li>Use the Deform brush to push shape folds organically.</li>
              <li>Hold Shift while dragging in Select mode to scale.</li>
              <li>Hold Alt while dragging in Select mode to rotate.</li>
              <li>Scroll wheel in Deform mode to resize the brush.</li>
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

  // Find prev / next keyframe for this sub-layer
  let prevKf: number | null = null;
  let nextKf: number | null = null;
  for (let i = idx; i >= 0; i--) {
    const f = project.frames[i];
    if (f?.isKeyframe && f.states[subLayerId]) {
      prevKf = i;
      break;
    }
  }
  for (let i = idx; i < project.frames.length; i++) {
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
        Lines and fills are interpolated linearly between the two keyframes.
      </p>
    );
  }
  if (prevKf !== null) {
    return <p>Holding from previous KF#{prevKf + 1}. Add a future keyframe to tween.</p>;
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
