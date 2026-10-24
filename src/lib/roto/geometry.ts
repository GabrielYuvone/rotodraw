// ============================================================
// VectorRot-Local — Geometry & Interpolation Utilities
// ============================================================

import type { Vec2, VectorShape } from "./types";

/** Simple seeded PRNG (mulberry32) for stable line-boil jitter. */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

/** Catmull-Rom spline point at t in [0,1] for 4 control points p0..p3. */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * Convert a polyline into a smoothed point list using Catmull-Rom.
 * Useful for both rendering and interpolation.
 */
export function smoothPolyline(points: Vec2[], segments = 8): Vec2[] {
  if (points.length < 3) return points.slice();
  const out: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(n - 1, i + 1)];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      out.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  out.push(points[n - 1]);
  return out;
}

/**
 * Apply stable "line boil" jitter to a polyline using a seed.
 * Per-call we re-derive the noise so the original point stays intact.
 */
export function applyLineBoil(
  points: Vec2[],
  seed: number,
  amount: number
): Vec2[] {
  if (amount <= 0) return points;
  const rng = mulberry32(seed);
  const noise = (range: number) => (rng() - 0.5) * 2 * range;
  return points.map((p) => ({
    x: p.x + noise(amount),
    y: p.y + noise(amount),
  }));
}

/** Render a VectorShape as a closed/open path on a Canvas2D context. */
export function tracePath(
  ctx: CanvasRenderingContext2D,
  shape: VectorShape,
  opts: { closed?: boolean; lineBoilAmount?: number } = {}
) {
  const pts = opts.lineBoilAmount
    ? applyLineBoil(shape.points, shape.seed, opts.lineBoilAmount)
    : shape.points;
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  // Use quadratic curves between midpoints for a smoother hand-drawn feel
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i];
    const next = pts[i + 1];
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    ctx.quadraticCurveTo(cur.x, cur.y, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  if (opts.closed ?? shape.fill.closed) ctx.closePath();
}

/**
 * Linear interpolation between two VectorShapes with matching point counts.
 * For mismatched counts, falls back to nearest-point mapping (no re-mesh yet).
 */
export function interpolateShapes(
  a: VectorShape,
  b: VectorShape,
  t: number
): VectorShape {
  // If counts match, interpolate point-by-point; else use the longer shape and
  // clamp missing indices to the last available point (cheap re-mesh).
  const n = Math.max(a.points.length, b.points.length);
  const points: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const pa = a.points[Math.min(i, a.points.length - 1)];
    const pb = b.points[Math.min(i, b.points.length - 1)];
    points.push(lerpVec2(pa, pb, t));
  }
  return {
    id: a.id,
    points,
    stroke: {
      color: a.stroke.color,
      width: lerp(a.stroke.width, b.stroke.width, t),
      jitter: lerp(a.stroke.jitter, b.stroke.jitter, t),
      variance: lerp(a.stroke.variance, b.stroke.variance, t),
    },
    fill: {
      enabled: a.fill.enabled,
      color: a.fill.color,
      closed: a.fill.closed || b.fill.closed,
    },
    seed: a.seed,
  };
}

/**
 * Find the nearest point on a polyline to a target point.
 * Returns the squared distance and the index of the segment.
 */
export function nearestPointOnPolyline(
  pts: Vec2[],
  target: Vec2
): { dist2: number; segIndex: number; t: number; point: Vec2 } {
  let best = { dist2: Infinity, segIndex: 0, t: 0, point: pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = target.x - a.x;
    const apy = target.y - a.y;
    const ab2 = abx * abx + aby * aby || 1;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const dx = target.x - px;
    const dy = target.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < best.dist2) {
      best = { dist2: d2, segIndex: i, t, point: { x: px, y: py } };
    }
  }
  return best;
}

/** Bounding box of a VectorShape (used for hit-testing & selection bounds). */
export function shapeBBox(pts: Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Distance from point p to a segment ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby || 1;
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + abx * t;
  const py = a.y + aby * t;
  return Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2);
}

/** Approximate distance from a point to a shape's outline. */
export function distanceToShape(p: Vec2, shape: VectorShape): number {
  let min = Infinity;
  const pts = shape.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(p, pts[i], pts[i + 1]);
    if (d < min) min = d;
  }
  if (shape.fill.closed && pts.length > 1) {
    const d = distToSegment(p, pts[pts.length - 1], pts[0]);
    if (d < min) min = d;
  }
  return min;
}

/** Generate a unique id with an optional prefix. */
let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}
