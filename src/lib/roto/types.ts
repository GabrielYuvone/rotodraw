// ============================================================
// VectorRot-Local — Core Type System
// A single-brush vector rotoscoping & cel-shading animation tool
// Inspired by Bob Sabiston's Rotoshop
// ============================================================

/** A 2D point with optional control handles for cubic bezier smoothing. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Stroke style applied to a vector shape (comic outline). */
export interface StrokeStyle {
  color: string;        // hex/rgb. Default "#000000" for black comic outline
  width: number;        // px in canvas space
  /** Organic stroke variance — 0 = rigid, 1 = strong "line boil" jitter. */
  jitter: number;
  /** Variable stroke thickness: 0 = uniform, 1 = high variance along path. */
  variance: number;
}

/** Fill style applied to a closed vector shape (cel-shading flat color). */
export interface FillStyle {
  enabled: boolean;
  color: string;        // flat color, e.g. "#3b6fb5" for "Pleno Azul"
  closed: boolean;       // path auto-closes to first point
}

/**
 * A vector shape lives inside a sub-layer.
 * Stored as a polyline of points; we render with Catmull-Rom → cubic bezier
 * smoothing so hand-drawn strokes look organic without per-anchor handles.
 */
export interface VectorShape {
  id: string;
  /** Ordered list of points in canvas-space coordinates (origin top-left). */
  points: Vec2[];
  stroke: StrokeStyle;
  fill: FillStyle;
  /** Random seed used for stable per-shape "line boil" jitter. */
  seed: number;
}

/**
 * A SubLayer holds a list of vector shapes for one logical cel
 * (e.g. "Contorno" outline, "Pleno Azul" flat, "Sombra Oscura" shadow).
 */
export interface SubLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Visual marker for the sub-layer's role. */
  kind: "outline" | "fill" | "shadow" | "highlight" | "custom";
  shapes: VectorShape[];
}

/**
 * A Layer is a parent in the hierarchy (e.g. "Remera", "Cara").
 * Contains ordered sub-layers.
 */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Sub-layers ordered bottom → top in z-stack. */
  subLayers: SubLayer[];
  /** Optional UI color label for the layer header. */
  color?: string;
}

/**
 * A Frame holds a per-sub-layer shape snapshot.
 * - If `isKeyframe` is true, the shapes per sub-layer are stored directly.
 * - If false, the frame is an in-between whose shapes are *interpolated*
 *   from the surrounding keyframes at playback / render time.
 */
export interface Frame {
  index: number;          // 0-based timeline index
  isKeyframe: boolean;
  /** Per-sub-layer shape snapshots. Empty/missing entries = no edit (inherited). */
  states: Record<string, VectorShape[]>; // key: subLayerId
}

/** Project-level FPS conversion options (authentic hand-drawn look). */
export type WorkingFPS = 6 | 8 | 12 | 24;

/** Working resolution scale relative to source video. */
export interface ResolutionConfig {
  /** Native source width/height in pixels. */
  sourceWidth: number;
  sourceHeight: number;
  /** Working canvas width/height (≤ source). */
  workingWidth: number;
  workingHeight: number;
  /** Display scale applied to fit canvas into the viewport. */
  displayScale: number;
}

/** Tool modes for the unified multi-purpose brush. */
export type ToolMode = "draw" | "blob" | "deform" | "knife" | "node" | "select";

/** Deformation brush scope: which sub-layers a deform brush stroke affects. */
export type DeformScope = "local" | "global";

/** Top-level project state (serializable to JSON for save/load). */
export interface RotoProject {
  name: string;
  fps: WorkingFPS;
  resolution: ResolutionConfig;
  /** Total number of frames in the working timeline. */
  frameCount: number;
  layers: Layer[];
  frames: Frame[];
  /** Currently active frame index. */
  currentFrame: number;
  /** Active sub-layer id (where new strokes are drawn). */
  activeSubLayerId: string | null;
  /**
   * Per-sub-layer drawing breaks. Each entry is a sorted list of frame
   * indices where a "drawing break" exists. A break marks the start of a
   * new independent drawing within the same sub-layer, stopping
   * interpolation from crossing it.
   *
   * Use case: when a character rotates drastically (e.g., front → profile),
   * the user inserts a drawing break at that frame and starts a fresh
   * drawing. The previous drawing's shapes will not be interpolated /
   * stretched across the break — frames after the break are blank until
   * the user draws a new keyframe in the new span.
   *
   * All layer styles (black comic stroke, blue fill, etc.) are preserved
   * because they live on the VectorShape itself, not on the span.
   */
  drawingBreaks: Record<string, number[]>;
}

/** Onion skinning configuration. */
export interface OnionSkinConfig {
  enabled: boolean;
  previousFrames: number;  // # of previous frames to ghost
  nextFrames: number;      // # of next frames to ghost
  opacityStep: number;     // 0..1 — opacity decrement per step
}

/** Brush / tool configuration for the unified brush. */
export interface BrushConfig {
  mode: ToolMode;
  /** Deform brush radius in canvas-space px (mouse wheel adjustable). */
  deformRadius: number;
  /** Deform strength 0..1 (push = +, pull = −). */
  deformStrength: number;
  /** Deform scope — local = only active sub-layer; global = entire parent layer. */
  deformScope: DeformScope;
  /** Drawing stroke width. */
  drawStrokeWidth: number;
  /** Drawing stroke jitter (line boil amount). */
  drawStrokeJitter: number;
  /** Drawing stroke variance. */
  drawStrokeVariance: number;
  /**
   * Drawing smoothing level (0..5). 0 = no smoothing (raw points as drawn),
   * 5 = heavy smoothing (Catmull-Rom + Chaikin iterations). Higher levels
   * produce smoother, more elegant curves at the cost of less precise
   * control over individual anchor points.
   */
  drawSmoothing: number;
  /** Default fill color for new draw strokes. */
  fillColor: string;
  /** Whether new strokes auto-close for fills. */
  autoClose: boolean;
  /** Blob brush radius (used by Blob tool — the resulting union shape's outline). */
  blobBrushRadius: number;
  /**
   * Blob brush smoothing level (0..5). Same as `drawSmoothing` but applied
   * to the blob stroke's polygon before boolean union.
   */
  blobSmoothing: number;
  /** Knife tool auto-closes the cut path before subtraction. */
  knifeAutoClose: boolean;
  /** Node tool: snap radius in canvas-space px for selecting a node. */
  nodeSnapRadius: number;
}
