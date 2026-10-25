# VectorRot-Local

A modern, local-first web application for manual vector rotoscoping and cel-shading animation, inspired by Bob Sabiston's Rotoshop. Built with Next.js, React, TypeScript, Tailwind CSS, and HTML5 Canvas.

## Features

### Core Drawing Engine
- **Unified Multi-Purpose Brush** — Draw, Blob, Deform, Relax, Knife, Node, Select tools
- **Blob Brush** — Illustrator-style boolean union of same-color strokes into solid fill blocks
- **Knife Tool** — Slice closed shapes into independent pieces via boolean subtraction
- **Node Tool** — Edit control points, delete nodes (Shift+click), drag to reposition
- **Relax Tool** — Redistribute nodes evenly along a path, removing jitter and excess nodes
- **Black Comic Stroke + Flat Color Fill** — Toggle outline and fill independently
- **Smoothing Levels** (0–5) — Chaikin corner-cutting algorithm for clean curves
- **Line Boil** — Organic stroke jitter for the handmade rotoscoping look

### Layer System
- **Nested Layer/Sub-layer Hierarchy** — e.g., `Remera > Contorno / Pleno Azul / Sombra Oscura / Detalle Claro`
- Lock, hide, reorder, rename any layer or sub-layer
- Per-shape fill color with quick presets

### Animation
- **Keyframe-based Interpolation** — Linear tweening between keyframes
- **Drawing Breaks** — Insert a break to start a fresh drawing in the same sub-layer (for character turns)
- **Onion Skinning** — Ghost previous/next frames in red/green
- **Timeline** — Frame strip with keyframe diamonds and break indicators, playback at 0.25×–2× speed

### Optical Flow Propagation (Vector-EbSynth)
- Extracts per-frame motion vectors from the underlying video using block-matching optical flow
- Propagates vector shape nodes forward across frames following the video's motion
- Preserves crisp comic lines and solid fills — only moves the nodes, not the pixels
- **Human-in-the-Loop Control Loop**: pause at any frame, manually correct with Deform/Node tools, then re-propagate from the corrected "ground truth" frame
- Cancel propagation mid-run, or propagate by segments (frame A → frame B)

### Deformation Brush (Liquify)
- **Snapshot-based** — tracks the cursor 1:1 × strength × falloff, no compounding
- **Local / Global scope** — deform a single sub-layer or the entire parent layer
- Proportional push/pull with adjustable radius (`[` / `]` keys)

### View & Navigation
- **Zoom** — Scroll wheel to zoom in/out at cursor (CSS transform, no re-rasterization)
- **Pan** — Hold `Z` or `Space` + drag to pan; release to return to previous tool
- **Space tap** = play/pause; **Space hold + drag** = pan
- `0` = reset view, `B` = toggle drawing break

### Undo/Redo
- `Ctrl+Z` = undo, `Ctrl+Shift+Z` / `Ctrl+Y` = redo
- History stack with up to 50 snapshots

### Export
- **Video Export** — Renders every timeline frame (video + vector shapes) to a .webm file via MediaRecorder
- **Project JSON** — Save/load the full project state (layers, frames, keyframes, drawing breaks)

### Input Support
- **Pointer Events API** — Full support for stylus (Wacom, Huion, iPad Pencil, Surface Pen), touch, and mouse
- `setPointerCapture` ensures drawing continues even if the stylus leaves the canvas

## Tech Stack
- Next.js 16 with App Router
- TypeScript 5
- Tailwind CSS 4 with shadcn/ui
- Zustand for state management
- polygon-clipping for boolean operations
- HTML5 Canvas for rendering

## Getting Started

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` (tap) | Play / Pause |
| `Space` (hold + drag) | Pan canvas |
| `Z` (hold + drag) | Pan canvas (returns to tool on release) |
| `0` | Reset view to fit |
| `B` | Toggle drawing break at current frame |
| `[` / `]` | Decrease / increase brush radius (Deform, Blob, Relax) |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete selected node or shape |
| `Shift+click` (Node tool) | Delete node directly |
| `Shift+drag` (Select tool) | Scale |
| `Alt+drag` (Select tool) | Rotate |

## License

MIT
