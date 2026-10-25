// ============================================================
// VectorRot-Local — Geometry & Interpolation Utilities
// ============================================================

import type { Vec2, VectorShape } from "./types";
import polygonClipping from "polygon-clipping";

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
      enabled: a.stroke.enabled,
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

// ============================================================
// Stroke smoothing
// Used by the Draw and Blob brush tools to produce cleaner, more
// organic strokes from raw mouse/stylus input. Implements two
// complementary smoothing strategies:
//
//  1. Distance-based point reduction (Simplify): remove points
//     closer than `tolerance` to their predecessor. This cleans
//     up tiny jitter from hand tremor.
//  2. Chaikin's corner-cutting algorithm (Smooth): iteratively
//     replace each segment with two new points at 25% and 75%
//     along the segment. Each iteration roughly doubles the
//     point count and halves the high-frequency noise.
//
// The `drawSmoothing` setting (0..5) controls how many Chaikin
// iterations to apply. Level 0 keeps the raw input; level 5
// produces very smooth, slightly loose curves.
// ============================================================

/**
 * Chaikin's corner-cutting smoothing for an open or closed polyline.
 * Returns a new array of points; does not mutate the input.
 *
 * @param points Input polyline.
 * @param iterations Number of Chaikin iterations to apply.
 * @param closed If true, the polyline is treated as closed (the
 *               last segment connects back to the first).
 */
export function chaikinSmooth(
  points: Vec2[],
  iterations: number,
  closed: boolean
): Vec2[] {
  if (iterations <= 0 || points.length < 3) return points.slice();
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    const out: Vec2[] = [];
    const n = pts.length;
    if (closed) {
      // For a closed polyline, smooth across the seam too.
      for (let i = 0; i < n; i++) {
        const cur = pts[i];
        const next = pts[(i + 1) % n];
        out.push({
          x: 0.75 * cur.x + 0.25 * next.x,
          y: 0.75 * cur.y + 0.25 * next.y,
        });
        out.push({
          x: 0.25 * cur.x + 0.75 * next.x,
          y: 0.25 * cur.y + 0.75 * next.y,
        });
      }
    } else {
      // For an open polyline, keep the endpoints fixed.
      out.push(pts[0]);
      for (let i = 0; i < n - 1; i++) {
        const cur = pts[i];
        const next = pts[i + 1];
        out.push({
          x: 0.75 * cur.x + 0.25 * next.x,
          y: 0.75 * cur.y + 0.25 * next.y,
        });
        out.push({
          x: 0.25 * cur.x + 0.75 * next.x,
          y: 0.25 * cur.y + 0.75 * next.y,
        });
      }
      out.push(pts[n - 1]);
    }
    pts = out;
  }
  return pts;
}

/**
 * Apply the user's selected smoothing level to a stroke.
 *
 * @param points Raw stroke points (already simplified by `simplifyPoints`).
 * @param level Smoothing level 0..5.
 * @param closed If true, smooth as a closed polyline.
 */
export function applySmoothingLevel(
  points: Vec2[],
  level: number,
  closed: boolean
): Vec2[] {
  if (level <= 0 || points.length < 3) return points.slice();
  // Level N → N Chaikin iterations. Each iteration roughly halves
  // high-frequency jitter while preserving the overall shape.
  return chaikinSmooth(points, Math.min(5, Math.max(1, level)), closed);
}

// ============================================================
// Polygon Boolean Utilities
// Used by the Blob Brush (boolean union of strokes), the Knife
// tool (boolean subtraction to slice shapes), and the global
// deform scope (which deforms all sub-layers in a parent layer).
// ============================================================

/** A polygon ring is a closed array of [x, y] pairs. */
export type Ring = number[][];

/**
 * Convert a VectorShape's polyline into a polygon ring ([x,y][]).
 * If the shape is closed, the first point is appended to close the ring.
 * Returns null if the shape has fewer than 3 points (cannot form a polygon).
 */
export function shapeToRing(shape: VectorShape): Ring | null {
  if (shape.points.length < 3) return null;
  const ring: Ring = shape.points.map((p) => [p.x, p.y]);
  // polygon-clipping expects rings to be closed (last == first).
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/**
 * Convert a stroke (polyline of Vec2) into a closed polygon "footprint"
 * representing the brush's footprint given the brush radius.
 *
 * Strategy: for each point on the stroke, compute the normal direction
 * (perpendicular to the local tangent). Generate two offset points — one
 * on each side. The left-side offsets form one boundary of the ribbon, the
 * right-side offsets (reversed) form the other. Concatenate to get a closed
 * polygon. End caps are simple semicircles for a smooth blob look.
 *
 * The resulting polygon is suitable for boolean union with existing shapes.
 */
export function strokeToPolygon(points: Vec2[], radius: number): Ring | null {
  if (points.length < 2) {
    // Single point → circle
    if (points.length === 1) {
      const ring: Ring = [];
      const cx = points[0].x;
      const cy = points[0].y;
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        ring.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
      }
      return ring;
    }
    return null;
  }

  // Compute normals along the stroke.
  const leftPts: Vec2[] = [];
  const rightPts: Vec2[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    // Tangent direction
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Normal (rotate 90° counter-clockwise): (-ty, tx)
    const nx = -ty;
    const ny = tx;
    leftPts.push({
      x: points[i].x + nx * radius,
      y: points[i].y + ny * radius,
    });
    rightPts.push({
      x: points[i].x - nx * radius,
      y: points[i].y - ny * radius,
    });
  }

  // Build the closed polygon: left points forward, then right points reversed,
  // then close back to start. End caps are added by joining left[last] → right[last]
  // and right[0] → left[0] (these are short line segments; for a smoother cap we
  // could add a semicircle, but a straight join works for cel-shading purposes).
  const ring: Ring = [];
  for (const p of leftPts) ring.push([p.x, p.y]);
  for (let i = rightPts.length - 1; i >= 0; i--) {
    ring.push([rightPts[i].x, rightPts[i].y]);
  }
  // Close
  ring.push([leftPts[0].x, leftPts[0].y]);
  return ring;
}

/**
 * Boolean union of multiple polygons. Returns a MultiPolygon
 * (array of polygons, each polygon = array of rings where ring[0] is the
 * outer boundary and ring[1..] are holes).
 */
export function booleanUnion(rings: Ring[]): Ring[][] {
  if (rings.length === 0) return [];
  if (rings.length === 1) return [[rings[0]]];
  try {
    const polys = rings.map((r) => [r]);
    const result = polygonClipping.union(polys[0], ...polys.slice(1));
    return result as Ring[][];
  } catch {
    // Fallback: return the first ring if union fails.
    return [rings];
  }
}

/**
 * Boolean subtraction: subtract `cutRings` from `subject`.
 * Returns a MultiPolygon of the remaining pieces.
 */
export function booleanSubtract(subject: Ring, cutRings: Ring[]): Ring[][] {
  try {
    const subjectPoly = [subject];
    const cutPolys = cutRings.map((r) => [r]);
    if (cutPolys.length === 0) return [subjectPoly];
    const result = polygonClipping.difference(subjectPoly, ...cutPolys);
    return result as Ring[][];
  } catch {
    return [[subject]];
  }
}

/**
 * Convert a MultiPolygon result back into VectorShape objects.
 * Each outer ring becomes one closed VectorShape. Holes are currently
 * dropped (cel-shading fills are typically solid; we can revisit if needed).
 */
export function multiPolygonToShapes(
  multi: Ring[][],
  base: Partial<VectorShape>
): VectorShape[] {
  const out: VectorShape[] = [];
  for (const poly of multi) {
    if (!poly || poly.length === 0) continue;
    const outer = poly[0];
    if (!outer || outer.length < 4) continue;
    // Drop the closing point (last == first) for our internal Vec2[] format.
    const points: Vec2[] = outer.slice(0, -1).map((p) => ({ x: p[0], y: p[1] }));
    if (points.length < 3) continue;
    out.push({
      id: uid("shape"),
      points,
      stroke: base.stroke ?? {
        enabled: true,
        color: "#000000",
        width: 2,
        jitter: 0,
        variance: 0,
      },
      fill: base.fill ?? {
        enabled: true,
        color: "#3b6fb5",
        closed: true,
      },
      seed: Math.floor(Math.random() * 1e9),
    });
  }
  return out;
}

/** Convert a single polygon Ring into a VectorShape (closed). */
export function ringToShape(ring: Ring, base: Partial<VectorShape>): VectorShape {
  const points: Vec2[] = ring.slice(0, -1).map((p) => ({ x: p[0], y: p[1] }));
  return {
    id: uid("shape"),
    points,
    stroke: base.stroke ?? {
      enabled: true,
      color: "#000000",
      width: 2,
      jitter: 0,
      variance: 0,
    },
    fill: base.fill ?? { enabled: true, color: "#3b6fb5", closed: true },
    seed: Math.floor(Math.random() * 1e9),
  };
}

/** Quick check whether a point is inside a closed polygon (ray-casting). */
export function pointInPolygon(p: Vec2, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Given a list of VectorShapes (in the same sub-layer), return the ones
 * that overlap a target point. Useful for hit-testing the global deform
 * brush against all shapes in a parent layer.
 */
export function shapesContainingPoint(
  shapes: VectorShape[],
  p: Vec2
): VectorShape[] {
  const out: VectorShape[] = [];
  for (const sh of shapes) {
    if (!sh.fill.closed) continue;
    const ring = shapeToRing(sh);
    if (!ring) continue;
    if (pointInPolygon(p, ring)) out.push(sh);
  }
  return out;
}

/** Find the index of the nearest node to a target point. */
export function nearestNode(
  shape: VectorShape,
  target: Vec2,
  maxDist: number
): number {
  let bestIdx = -1;
  let bestDist = maxDist;
  for (let i = 0; i < shape.points.length; i++) {
    const d = Math.hypot(
      shape.points[i].x - target.x,
      shape.points[i].y - target.y
    );
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}
