// ============================================================
// VectorRot-Local — Optical Flow (Vector-EbSynth)
// Lightweight frame-to-frame motion extraction using block
// matching. For each block of pixels in frame N, we search a
// small window in frame N+1 to find the best match (lowest
// sum-of-absolute-differences). The displacement of the best
// match is the motion vector for that block.
//
// The motion vectors are then used to propagate vector shape
// nodes: each node at (x, y) in frame N is shifted by the
// motion vector at its location to produce its position in
// frame N+1. This preserves crisp vector lines while making
// them follow the video's motion — like EbSynth but for paths.
// ============================================================

import type { Vec2 } from "./types";

/** A sparse grid of motion vectors. Each entry covers a block of `blockSize` pixels. */
export interface OpticalFlowField {
  /** Width of the source video in pixels. */
  width: number;
  /** Height of the source video in pixels. */
  height: number;
  /** Block size used for matching (e.g., 16 means a 16×16 block). */
  blockSize: number;
  /** Grid dimensions: cols = floor(width / blockSize), rows = floor(height / blockSize). */
  cols: number;
  rows: number;
  /**
   * Motion vectors stored as a flat array. The vector at grid
   * position (col, row) is at index `row * cols + col`. Each
   * entry is `{ dx, dy }` in source-pixel space.
   */
  vectors: Vec2[];
}

/**
 * Extract the grayscale pixel data from a canvas context.
 * Returns a Uint8ClampedArray of `width * height` bytes (one
 * byte per pixel, luminance).
 */
function getGrayscale(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): Uint8ClampedArray {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    // Standard luminance formula.
    gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
  }
  return gray;
}

/**
 * Compute the Sum of Absolute Differences (SAD) between a block
 * in frame A at (ax, ay) and a block in frame B at (bx, by).
 * Both frames are `width × height` grayscale arrays.
 */
function blockSAD(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blockSize: number
): number {
  let sad = 0;
  for (let dy = 0; dy < blockSize; dy++) {
    for (let dx = 0; dx < blockSize; dx++) {
      const ai = (ay + dy) * width + (ax + dx);
      const bi = (by + dy) * width + (bx + dx);
      if (ai < 0 || bi < 0 || ai >= a.length || bi >= b.length) continue;
      sad += Math.abs(a[ai] - b[bi]);
    }
  }
  return sad;
}

/**
 * Compute optical flow between two frames (grayscale arrays).
 * Uses exhaustive block matching with a search window of
 * `searchRadius` pixels. The result is a sparse grid of motion
 * vectors at `blockSize` intervals.
 *
 * @param frameA    Grayscale of frame N (previous).
 * @param frameB    Grayscale of frame N+1 (current).
 * @param width     Frame width in pixels.
 * @param height    Frame height in pixels.
 * @param blockSize Block size for matching (default 16).
 * @param searchRadius Search radius in pixels (default 8).
 */
export function computeOpticalFlow(
  frameA: Uint8ClampedArray,
  frameB: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize = 16,
  searchRadius = 8
): OpticalFlowField {
  const cols = Math.floor(width / blockSize);
  const rows = Math.floor(height / blockSize);
  const vectors: Vec2[] = new Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ax = col * blockSize;
      const ay = row * blockSize;
      let bestDx = 0;
      let bestDy = 0;
      let bestSAD = Infinity;
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
          const bx = ax + dx;
          const by = ay + dy;
          if (bx < 0 || by < 0 || bx + blockSize > width || by + blockSize > height) {
            continue;
          }
          const sad = blockSAD(
            frameA,
            frameB,
            width,
            height,
            ax,
            ay,
            bx,
            by,
            blockSize
          );
          if (sad < bestSAD) {
            bestSAD = sad;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      vectors[row * cols + col] = { dx: bestDx, dy: bestDy };
    }
  }

  return { width, height, blockSize, cols, rows, vectors };
}

/**
 * Sample the motion vector at a specific (x, y) position from a
 * flow field. Bilinearly interpolates between the four nearest
 * grid points for smoother results.
 */
export function sampleFlow(
  flow: OpticalFlowField,
  x: number,
  y: number
): Vec2 {
  const { blockSize, cols, rows, vectors } = flow;
  // Convert to grid coordinates.
  const gx = x / blockSize;
  const gy = y / blockSize;
  // Clamp to valid grid range.
  const cx = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
  const cy = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
  const cx2 = Math.min(cols - 1, cx + 1);
  const cy2 = Math.min(rows - 1, cy + 1);
  const fx = gx - cx;
  const fy = gy - cy;
  // Bilinear interpolation of the four nearest vectors.
  const v00 = vectors[cy * cols + cx];
  const v10 = vectors[cy * cols + cx2];
  const v01 = vectors[cy2 * cols + cx];
  const v11 = vectors[cy2 * cols + cx2];
  const dx =
    v00.dx * (1 - fx) * (1 - fy) +
    v10.dx * fx * (1 - fy) +
    v01.dx * (1 - fx) * fy +
    v11.dx * fx * fy;
  const dy =
    v00.dy * (1 - fx) * (1 - fy) +
    v10.dy * fx * (1 - fy) +
    v01.dy * (1 - fx) * fy +
    v11.dy * fx * fy;
  return { dx, dy };
}

/**
 * Propagate a set of vector shape nodes from frame N to frame N+1
 * using an optical flow field. Each node is shifted by the motion
 * vector at its position, scaled by `strength`.
 *
 * @param points   The shape's nodes in frame N (canvas-space).
 * @param flow     The optical flow field from frame N to N+1.
 * @param strength Multiplier for the motion (0 = no movement, 1 =
 *                 full optical flow, >1 = exaggerated).
 * @returns The propagated nodes for frame N+1.
 */
export function propagatePointsByFlow(
  points: Vec2[],
  flow: OpticalFlowField,
  strength: number
): Vec2[] {
  return points.map((p) => {
    const v = sampleFlow(flow, p.x, p.y);
    return {
      x: p.x + v.dx * strength,
      y: p.y + v.dy * strength,
    };
  });
}

/**
 * Extract a grayscale frame from a video element at the given
 * working resolution. The video must already be seeked to the
 * desired frame.
 *
 * @param video    The hidden <video> element.
 * @param width    Working canvas width.
 * @param height   Working canvas height.
 * @returns A Uint8ClampedArray of grayscale pixels, or null if
 *          the video isn't ready.
 */
export function extractGrayscaleFrame(
  video: HTMLVideoElement,
  width: number,
  height: number
): Uint8ClampedArray | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(
      video,
      0,
      0,
      video.videoWidth,
      video.videoHeight,
      0,
      0,
      width,
      height
    );
  } catch {
    return null;
  }
  return getGrayscale(ctx, width, height);
}

/**
 * Seek a video element to a time and wait for the `seeked` event.
 */
export function seekVideoAndWait(
  video: HTMLVideoElement,
  timeSec: number
): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = Math.max(0, timeSec);
    } catch {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    }
  });
}
