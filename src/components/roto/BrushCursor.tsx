"use client";

import { useEffect, useRef } from "react";

interface Props {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

/**
 * Visual indicator for the proportional deform brush.
 * Draws a soft circle whose size = brush radius and whose fill opacity
 * encodes the strength (push positive / pull negative).
 */
export function BrushCursor({ x, y, radius, strength }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const cx = el.width / 2;
    const cy = el.height / 2;
    // Falloff gradient
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, el.width / 2);
    grad.addColorStop(0, `rgba(255,235,59,${0.3 + strength * 0.3})`);
    grad.addColorStop(0.8, `rgba(255,235,59,0.08)`);
    grad.addColorStop(1, "rgba(255,235,59,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, el.width / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    // Outer ring
    ctx.strokeStyle = "rgba(255,235,59,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, el.width / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    // Center crosshair
    ctx.strokeStyle = "rgba(255,235,59,0.9)";
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx, cy + 6);
    ctx.stroke();
  }, [radius, strength]);

  const size = Math.max(20, radius * 2 + 4);

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
      }}
    >
      <canvas
        ref={ref}
        width={size}
        height={size}
        className="w-full h-full"
      />
    </div>
  );
}
