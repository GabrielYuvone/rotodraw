"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useRotoStore } from "@/lib/roto/store";
import type { ResolutionConfig, WorkingFPS } from "@/lib/roto/types";
import { Upload, Film, Settings2, Loader2 } from "lucide-react";

interface VideoMeta {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
}

const RES_SCALES = [
  { label: "Native (100%)", value: 1 },
  { label: "75%", value: 0.75 },
  { label: "50%", value: 0.5 },
  { label: "25%", value: 0.25 },
];

const FPS_OPTIONS: WorkingFPS[] = [6, 8, 12, 24];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function VideoUploaderDialog({ open, onClose }: Props) {
  const setVideo = useRotoStore((s) => s.setVideo);
  const setFpsStore = useRotoStore((s) => s.setFps);
  const setProjectName = useRotoStore((s) => s.setProjectName);
  const existingFps = useRotoStore((s) => s.project.fps);
  const existingName = useRotoStore((s) => s.project.name);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [projectNameInput, setProjectNameInput] = useState(existingName);
  const [scale, setScale] = useState<number>(1);
  const [fps, setLocalFps] = useState<WorkingFPS>(existingFps);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state when dialog opens. We only update state when the
  // values differ to avoid cascading renders (per react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectNameInput(existingName);
    setLocalFps(existingFps);
    setScale(1);
  }, [open, existingName, existingFps]);

  const handleFile = useCallback((file: File) => {
    setLoading(true);
    setError(null);
    setMeta(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setProjectNameInput(file.name.replace(/\.[^.]+$/, ""));
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.muted = true;
    hiddenVideoRef.current = v;
    v.onloadedmetadata = () => {
      // Many browsers don't expose fps directly; estimate from requestVideoFrameCallback
      // For simplicity, we assume 30fps source when unknown.
      let fpsEstimate = 30;
      const w = v.videoWidth || 1280;
      const h = v.videoHeight || 720;
      const durationSec = v.duration || 0;
      // requestVideoFrameCallback is available in modern Chromium.
      const rVFC =
        (v as unknown as {
          requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number; presentedFrames: number }) => void) => number;
        }).requestVideoFrameCallback;
      if (typeof rVFC === "function" && durationSec > 0) {
        let firstMediaTime: number | null = null;
        let firstNow: number | null = null;
        let frames = 0;
        const sample = (now: number, md: { mediaTime: number; presentedFrames: number }) => {
          if (firstMediaTime === null) {
            firstMediaTime = md.mediaTime;
            firstNow = now;
            frames = md.presentedFrames;
            rVFC(sample);
          } else {
            const dt = md.mediaTime - (firstMediaTime as number);
            const df = md.presentedFrames - frames;
            if (dt > 0 && df > 0) {
              fpsEstimate = Math.round(df / dt);
            }
            setMeta({ width: w, height: h, durationSec, fps: fpsEstimate });
            setLoading(false);
          }
        };
        v.play().then(() => rVFC(sample)).catch(() => {
          setMeta({ width: w, height: h, durationSec, fps: fpsEstimate });
          setLoading(false);
        });
      } else {
        setMeta({ width: w, height: h, durationSec, fps: fpsEstimate });
        setLoading(false);
      }
    };
    v.onerror = () => {
      setError("Could not read video metadata. Try a different file.");
      setLoading(false);
    };
  }, [videoUrl]);

  const handleApply = () => {
    if (!meta || !videoUrl) {
      setError("Please load a video first.");
      return;
    }
    const workingWidth = Math.max(64, Math.round(meta.width * scale));
    const workingHeight = Math.max(64, Math.round(meta.height * scale));
    // Compute frame count = durationSec * working fps
    const frameCount = Math.max(1, Math.round(meta.durationSec * fps));
    const resolution: ResolutionConfig = {
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      workingWidth,
      workingHeight,
      displayScale: 1, // canvas component recomputes
    };
    setProjectName(projectNameInput || "Untitled Roto");
    setFpsStore(fps);
    setVideo(videoUrl, resolution, frameCount);
    onClose();
  };

  const handleCancel = () => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setMeta(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? handleCancel() : null)}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="h-5 w-5" />
            New Rotoscoping Project
          </DialogTitle>
          <DialogDescription>
            Load a video and configure your working frame rate and resolution.
            Lower frame rates (6, 8, 12 FPS) produce the authentic hand-drawn
            look of classic rotoscoping.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* File picker */}
          <div className="grid gap-2">
            <Label htmlFor="video-file">Source Video</Label>
            <input
              id="video-file"
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button
              variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="justify-start"
            >
              <Upload className="h-4 w-4 mr-2" />
              {videoUrl ? "Change Video File…" : "Choose Video File…"}
            </Button>
            {videoUrl && meta && (
              <p className="text-xs text-muted-foreground">
                {meta.width}×{meta.height} · {meta.durationSec.toFixed(1)}s ·
                ~{meta.fps} FPS source
              </p>
            )}
            {loading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading metadata…
              </p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {/* Project name */}
          <div className="grid gap-2">
            <Label htmlFor="project-name">Project Name</Label>
            <Input
              id="project-name"
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              placeholder="Untitled Roto"
            />
          </div>

          {/* Resolution scaling */}
          <div className="grid gap-2">
            <Label>Working Resolution</Label>
            <Select
              value={String(scale)}
              onValueChange={(v) => setScale(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick resolution scale" />
              </SelectTrigger>
              <SelectContent>
                {RES_SCALES.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                    {meta
                      ? ` — ${Math.round(meta.width * opt.value)}×${Math.round(
                          meta.height * opt.value
                        )}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Downscale for snappier editing. The original file is preserved.
            </p>
          </div>

          {/* FPS */}
          <div className="grid gap-2">
            <Label>Working Frame Rate</Label>
            <RadioGroup
              value={String(fps)}
              onValueChange={(v) => setLocalFps(Number(v) as WorkingFPS)}
              className="grid grid-cols-4 gap-2"
            >
              {FPS_OPTIONS.map((f) => (
                <div
                  key={f}
                  className="flex items-center justify-center gap-2 rounded-md border border-input px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/10"
                >
                  <RadioGroupItem value={String(f)} id={`fps-${f}`} />
                  <Label htmlFor={`fps-${f}`} className="cursor-pointer font-medium">
                    {f} FPS
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              6–8 FPS = stop-motion / Waking Life. 12 FPS = classic cel. 24 FPS =
              smooth animation.
            </p>
          </div>

          {meta && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium flex items-center gap-1">
                <Settings2 className="h-3.5 w-3.5" /> Project Preview
              </p>
              <p className="mt-1 text-muted-foreground">
                Working canvas:{" "}
                <span className="font-mono text-foreground">
                  {Math.round(meta.width * scale)}×
                  {Math.round(meta.height * scale)}
                </span>{" "}
                · Timeline:{" "}
                <span className="font-mono text-foreground">
                  {Math.round(meta.durationSec * fps)} frames
                </span>{" "}
                @ {fps} FPS
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!meta || loading}>
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
