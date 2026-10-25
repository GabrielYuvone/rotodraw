"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "@/components/roto/Toolbar";
import { LayerManager } from "@/components/roto/LayerManager";
import { RotoCanvas } from "@/components/roto/RotoCanvas";
import { PropertiesPanel } from "@/components/roto/PropertiesPanel";
import { Timeline } from "@/components/roto/Timeline";
import { VideoUploaderDialog } from "@/components/roto/VideoUploaderDialog";
import { useRotoStore } from "@/lib/roto/store";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [uploaderOpen, setUploaderOpen] = useState(true);

  const videoUrl = useRotoStore((s) => s.videoUrl);
  const frameCount = useRotoStore((s) => s.project.frameCount);
  const currentFrame = useRotoStore((s) => s.project.currentFrame);
  const fps = useRotoStore((s) => s.project.fps);

  // Attach the video URL to the hidden <video> element whenever it changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (videoUrl) {
      v.src = videoUrl;
      v.load();
    } else {
      v.removeAttribute("src");
      v.load();
    }
  }, [videoUrl]);

  // Seek the hidden video element to a specific time (seconds).
  // We dispatch "roto-seek-start" before setting currentTime so the canvas
  // knows the video is mid-seek and can fall back to the cached frame
  // (preventing black-frame flicker). The video's `seeked` event then
  // dispatches "roto-seek-end" to signal that the new frame is ready.
  const seekVideo = useCallback((timeSec: number) => {
    const v = videoRef.current;
    if (!v || !v.src) return;
    if (Math.abs(v.currentTime - timeSec) > 0.001) {
      window.dispatchEvent(new CustomEvent("roto-seek-start"));
      try {
        v.currentTime = Math.max(0, timeSec);
      } catch {
        // ignore
        window.dispatchEvent(new CustomEvent("roto-seek-end"));
      }
    }
  }, []);

  // When the video finishes seeking, notify the canvas so it can switch
  // back to drawing the live video frame (instead of the cache).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeeked = () => {
      window.dispatchEvent(new CustomEvent("roto-seek-end"));
    };
    v.addEventListener("seeked", onSeeked);
    return () => v.removeEventListener("seeked", onSeeked);
  }, [videoUrl]);

  // Seek when frame changes
  useEffect(() => {
    if (frameCount > 0) {
      seekVideo(currentFrame / fps);
    }
  }, [currentFrame, fps, frameCount, seekVideo]);

  const onNewProject = () => {
    toast({
      title: "New project",
      description: "Choose a new video to start a fresh rotoscoping project.",
    });
    setUploaderOpen(true);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      {/* Hidden video element for frame extraction */}
      <video
        ref={videoRef}
        className="hidden"
        muted
        playsInline
        preload="auto"
      />

      {/* Top toolbar */}
      <Toolbar onNewProject={onNewProject} videoRef={videoRef} />

      {/* Main 3-column workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Layer Manager */}
        <aside className="w-72 border-r bg-card shrink-0 hidden md:block">
          <LayerManager />
        </aside>

        {/* Center: Canvas */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 min-h-0 p-3">
            <RotoCanvas videoRef={videoRef} />
          </div>
          <Timeline />
        </main>

        {/* Right: Properties */}
        <aside className="w-72 border-l bg-card shrink-0 hidden lg:block">
          <PropertiesPanel />
        </aside>
      </div>

      {/* Video uploader / project setup dialog */}
      <VideoUploaderDialog open={uploaderOpen} onClose={() => setUploaderOpen(false)} />
    </div>
  );
}
