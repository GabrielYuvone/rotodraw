// ============================================================
// VectorRot-Local — Video Export
// Renders each timeline frame (video background + vector shapes)
// to an offscreen canvas and records it with the MediaRecorder API,
// producing a downloadable .webm video file at the project's FPS.
// ============================================================

import type { RotoProject, VectorShape } from "./types";
import { getInterpolatedShapesForFrame } from "./store";

/** Choose the best supported video MIME type for MediaRecorder. */
function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "video/webm";
}

/** File extension for the chosen MIME type. */
function extForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}

/** Promise that resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Seek a video element to a time and wait for the `seeked` event. */
function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.max(0, time);
  });
}

/** Draw a single vector shape onto a canvas context (fill + stroke). */
function drawShape(ctx: CanvasRenderingContext2D, sh: VectorShape) {
  if (sh.points.length < 2) return;
  ctx.save();
  // Fill first (if closed)
  if (sh.fill.enabled && sh.fill.closed && sh.points.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(sh.points[0].x, sh.points[0].y);
    for (let i = 1; i < sh.points.length - 1; i++) {
      const cur = sh.points[i];
      const next = sh.points[i + 1];
      ctx.quadraticCurveTo(
        cur.x,
        cur.y,
        (cur.x + next.x) / 2,
        (cur.y + next.y) / 2
      );
    }
    ctx.lineTo(
      sh.points[sh.points.length - 1].x,
      sh.points[sh.points.length - 1].y
    );
    if (sh.fill.closed) ctx.closePath();
    ctx.fillStyle = sh.fill.color;
    ctx.fill();
  }
  // Stroke (only if enabled)
  if (sh.stroke.enabled) {
    ctx.beginPath();
    ctx.moveTo(sh.points[0].x, sh.points[0].y);
    for (let i = 1; i < sh.points.length - 1; i++) {
      const cur = sh.points[i];
      const next = sh.points[i + 1];
      ctx.quadraticCurveTo(
        cur.x,
        cur.y,
        (cur.x + next.x) / 2,
        (cur.y + next.y) / 2
      );
    }
    ctx.lineTo(
      sh.points[sh.points.length - 1].x,
      sh.points[sh.points.length - 1].y
    );
    if (sh.fill.closed) ctx.closePath();
    ctx.strokeStyle = sh.stroke.color;
    ctx.lineWidth = sh.stroke.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Export the project as a video file.
 *
 * Steps through every frame in the timeline, renders the video background
 * plus the vector shapes (with interpolation) to an offscreen canvas, and
 * records the canvas stream with MediaRecorder at the project's FPS.
 *
 * @param project   The current project state.
 * @param video     The hidden <video> element (used for frame extraction).
 * @param onProgress Called with (frame, total) after each frame is rendered.
 * @returns A Blob containing the video data.
 */
export async function exportVideo(
  project: RotoProject,
  video: HTMLVideoElement,
  onProgress?: (frame: number, total: number) => void
): Promise<Blob> {
  const { workingWidth, workingHeight } = project.resolution;
  const fps = project.fps;
  const totalFrames = project.frameCount;

  // Create an offscreen canvas for rendering at the working resolution.
  const canvas = document.createElement("canvas");
  canvas.width = workingWidth;
  canvas.height = workingHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // Create a stream from the canvas at the project's FPS.
  const stream = canvas.captureStream(fps);

  // Choose the best supported codec.
  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000, // 8 Mbps for good quality
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  recorder.start();

  // Step through every frame in the timeline.
  for (let i = 0; i < totalFrames; i++) {
    // Seek the video to this frame's time and wait for it to be ready.
    const time = i / fps;
    try {
      await seekVideo(video, time);
    } catch {
      // If seeking fails, just continue — we'll draw whatever frame is available.
    }
    // Small extra delay to ensure the video frame is fully decoded.
    await sleep(30);

    // Clear and draw the video background.
    ctx.clearRect(0, 0, workingWidth, workingHeight);
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        ctx.drawImage(
          video,
          0,
          0,
          video.videoWidth,
          video.videoHeight,
          0,
          0,
          workingWidth,
          workingHeight
        );
      } catch {
        // ignore drawImage errors
      }
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, workingWidth, workingHeight);
    }

    // Draw vector shapes for this frame (with interpolation).
    for (const layer of project.layers) {
      if (!layer.visible) continue;
      for (const sub of layer.subLayers) {
        if (!sub.visible) continue;
        const shapes = getInterpolatedShapesForFrame(project, i, sub.id);
        for (const sh of shapes) {
          drawShape(ctx, sh);
        }
      }
    }

    onProgress?.(i + 1, totalFrames);

    // Wait one frame duration so the MediaRecorder captures this frame.
    await sleep(Math.max(50, 1000 / fps));
  }

  // Small delay before stopping to ensure the last frame is captured.
  await sleep(200);
  recorder.stop();

  return finished;
}

/** Trigger a browser download of a video Blob. */
export function downloadVideoBlob(blob: Blob, projectName: string, mimeType: string) {
  const ext = extForMime(mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/\s+/g, "_")}.${ext}`;
  a.click();
  // Revoke after a short delay so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Check if the browser supports video recording via MediaRecorder. */
export function canExportVideo(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype
  );
}
