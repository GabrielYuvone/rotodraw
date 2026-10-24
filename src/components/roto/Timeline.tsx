"use client";

import { useCallback, useRef } from "react";
import {
  Diamond,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Layers,
  Film,
  Unlink,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  useRotoStore,
  hasDrawingBreak,
  getDrawingBreaks,
} from "@/lib/roto/store";
import { useEffect, useState } from "react";

export function Timeline() {
  const project = useRotoStore((s) => s.project);
  const onion = useRotoStore((s) => s.onion);
  const setCurrentFrame = useRotoStore((s) => s.setCurrentFrame);
  const toggleKeyframe = useRotoStore((s) => s.toggleKeyframe);
  const clearFrame = useRotoStore((s) => s.clearFrame);
  const setOnion = useRotoStore((s) => s.setOnion);
  const toggleDrawingBreak = useRotoStore((s) => s.toggleDrawingBreak);
  const activeSubLayerId = project.activeSubLayerId;
  const currentFrame = project.currentFrame;
  const hasBreak =
    activeSubLayerId != null &&
    hasDrawingBreak(project, activeSubLayerId, currentFrame);

  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const frameAccumRef = useRef<number>(0);

  // Playback loop
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    lastTimeRef.current = performance.now();
    frameAccumRef.current = 0;
    const tick = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      frameAccumRef.current += dt * project.fps;
      if (frameAccumRef.current >= 1) {
        const steps = Math.floor(frameAccumRef.current);
        frameAccumRef.current -= steps;
        const next = (project.currentFrame + steps) % project.frameCount;
        setCurrentFrame(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, project.fps, project.currentFrame, project.frameCount, setCurrentFrame]);

  const onScrub = useCallback(
    (val: number) => {
      setCurrentFrame(val);
    },
    [setCurrentFrame]
  );

  const step = (delta: number) => {
    let next = project.currentFrame + delta;
    if (next < 0) next = 0;
    if (next >= project.frameCount) next = project.frameCount - 1;
    setCurrentFrame(next);
  };

  const jumpToKeyframe = (direction: -1 | 1) => {
    let i = project.currentFrame + direction;
    while (i >= 0 && i < project.frameCount) {
      if (project.frames[i]?.isKeyframe) {
        setCurrentFrame(i);
        return;
      }
      i += direction;
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 border-t bg-card">
      {/* Top row: transport + frame display */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurrentFrame(0)}
            aria-label="Jump to start"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => step(-1)}
            aria-label="Previous frame"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play"}
            className="px-3"
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => step(1)}
            aria-label="Next frame"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurrentFrame(project.frameCount - 1)}
            aria-label="Jump to end"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-muted/50 text-sm">
          <Film className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono">
            Frame {project.currentFrame + 1} / {project.frameCount}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono">
            {(project.currentFrame / project.fps).toFixed(2)}s
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="font-mono">{project.fps} FPS</span>
        </div>

        <div className="flex-1" />

        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => jumpToKeyframe(-1)}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev KF
              </Button>
            </TooltipTrigger>
            <TooltipContent>Jump to previous keyframe</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={() => jumpToKeyframe(1)}>
                Next KF <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Jump to next keyframe</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button
          size="sm"
          variant={
            project.frames[project.currentFrame]?.isKeyframe
              ? "default"
              : "outline"
          }
          onClick={() => toggleKeyframe(project.currentFrame)}
        >
          <Diamond className="h-3.5 w-3.5 mr-1" />
          {project.frames[project.currentFrame]?.isKeyframe
            ? "Keyframe ✓"
            : "Make Keyframe"}
        </Button>

        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={hasBreak ? "destructive" : "outline"}
                onClick={() => {
                  if (!activeSubLayerId) return;
                  toggleDrawingBreak(activeSubLayerId, currentFrame);
                }}
                disabled={!activeSubLayerId}
              >
                {hasBreak ? (
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                ) : (
                  <Unlink className="h-3.5 w-3.5 mr-1" />
                )}
                {hasBreak ? "Remove Drawing Break" : "Insert Drawing Break"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {hasBreak
                ? "Re-enable interpolation across this frame (reconnects the previous drawing with the next)."
                : "Start a fresh independent drawing at this frame for the active sub-layer. Stops interpolation from the previous drawing — useful when a character turns. (Shortcut: B)"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => clearFrame(project.currentFrame)}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
      </div>

      {/* Frame strip */}
      <div className="relative flex items-center gap-2">
        <Slider
          value={[project.currentFrame]}
          max={Math.max(0, project.frameCount - 1)}
          step={1}
          onValueChange={(v) => onScrub(v[0])}
          className="flex-1"
          aria-label="Frame scrubber"
        />
        <FrameStrip />
      </div>

      {/* Onion skin controls */}
      <div className="flex items-center gap-4 flex-wrap pt-1">
        <div className="flex items-center gap-2">
          <Switch
            id="onion-enabled"
            checked={onion.enabled}
            onCheckedChange={(v) => setOnion({ enabled: v })}
          />
          <Label htmlFor="onion-enabled" className="text-xs flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" /> Onion Skin
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Prev</Label>
          <Slider
            value={[onion.previousFrames]}
            min={0}
            max={6}
            step={1}
            onValueChange={(v) => setOnion({ previousFrames: v[0] })}
            className="w-20"
          />
          <span className="text-xs font-mono w-4">{onion.previousFrames}</span>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Next</Label>
          <Slider
            value={[onion.nextFrames]}
            min={0}
            max={6}
            step={1}
            onValueChange={(v) => setOnion({ nextFrames: v[0] })}
            className="w-20"
          />
          <span className="text-xs font-mono w-4">{onion.nextFrames}</span>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Opacity</Label>
          <Slider
            value={[Math.round(onion.opacityStep * 100)]}
            min={5}
            max={50}
            step={5}
            onValueChange={(v) => setOnion({ opacityStep: v[0] / 100 })}
            className="w-20"
          />
          <span className="text-xs font-mono w-8">
            {Math.round(onion.opacityStep * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

/** Frame-by-frame strip showing keyframe diamonds + drawing break indicators. */
function FrameStrip() {
  const project = useRotoStore((s) => s.project);
  const setCurrentFrame = useRotoStore((s) => s.setCurrentFrame);
  const total = project.frameCount;
  const activeSubLayerId = project.activeSubLayerId;
  // Per-frame break lookup for the active sub-layer (used for the red indicator).
  const breaks =
    activeSubLayerId != null
      ? new Set(getDrawingBreaks(project, activeSubLayerId))
      : new Set<number>();
  // Cap visible frames for performance
  const VISIBLE_MAX = 60;
  const showEvery = Math.max(1, Math.ceil(total / VISIBLE_MAX));
  const frames: number[] = [];
  for (let i = 0; i < total; i += showEvery) frames.push(i);
  if (frames[frames.length - 1] !== total - 1) frames.push(total - 1);

  return (
    <div className="flex items-end gap-1 overflow-x-auto max-w-[60%] max-h-12 pb-1">
      {frames.map((i) => {
        const f = project.frames[i];
        const isCurrent = i === project.currentFrame;
        const isBreak = breaks.has(i);
        return (
          <button
            key={i}
            onClick={() => setCurrentFrame(i)}
            className={`relative flex flex-col items-center justify-end px-1 pt-3 pb-0.5 rounded-sm border text-[10px] font-mono min-w-[28px]
              ${
                isCurrent
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border bg-card/60 text-muted-foreground hover:bg-accent"
              }
              ${isBreak ? "border-l-2 border-l-red-500" : ""}`}
            title={`Frame ${i + 1}${
              f?.isKeyframe ? " (Keyframe)" : ""
            }${isBreak ? " · Drawing Break (new drawing starts here)" : ""}`}
          >
            <span className="absolute top-0.5">
              {f?.isKeyframe && (
                <Diamond
                  className="h-2.5 w-2.5 fill-primary text-primary"
                />
              )}
            </span>
            {isBreak && (
              <span
                className="absolute -top-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50"
                aria-label="drawing break"
              />
            )}
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
