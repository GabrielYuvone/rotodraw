"use client";

import {
  Pen,
  Spline,
  MousePointer2,
  Save,
  FolderOpen,
  Film,
  Plus,
  Settings2,
  CircleDot,
  Scissors,
  Spline as SplineIcon,
  Globe,
  Crosshair,
  ZoomIn,
  ZoomOut,
  Maximize,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { useRotoStore } from "@/lib/roto/store";
import type { ToolMode, DeformScope } from "@/lib/roto/types";

interface Props {
  onNewProject: () => void;
}

export function Toolbar({ onNewProject }: Props) {
  const project = useRotoStore((s) => s.project);
  const brush = useRotoStore((s) => s.brush);
  const view = useRotoStore((s) => s.view);
  const setTool = useRotoStore((s) => s.setTool);
  const setBrush = useRotoStore((s) => s.setBrush);
  const setProjectName = useRotoStore((s) => s.setProjectName);
  const setView = useRotoStore((s) => s.setView);
  const resetView = useRotoStore((s) => s.resetView);
  const loadProject = useRotoStore((s) => s.loadProject);

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = () => {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "_")}.vectorrot.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        loadProject(data);
      } catch (err) {
        console.error("Failed to load project:", err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card flex-wrap">
        {/* Project identity */}
        <div className="flex items-center gap-2 min-w-0">
          <Film className="h-5 w-5 text-primary shrink-0" />
          <Input
            value={project.name}
            onChange={(e) => setProjectName(e.target.value)}
            className="h-7 w-48 text-sm"
            placeholder="Project name"
          />
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Tool selector */}
        <ToggleGroup
          type="single"
          value={brush.mode}
          onValueChange={(v) => {
            if (v) setTool(v as ToolMode);
          }}
          className="gap-1"
        >
          <ToolToggle value="draw" label="Draw Brush — vector stroke with black outline" icon={<Pen className="h-4 w-4" />} />
          <ToolToggle value="blob" label="Blob Brush — boolean union of same-color strokes" icon={<CircleDot className="h-4 w-4" />} />
          <ToolToggle value="deform" label="Deform / Liquify — proportional push/pull" icon={<Spline className="h-4 w-4" />} />
          <ToolToggle value="knife" label="Knife — slice closed shapes into pieces" icon={<Scissors className="h-4 w-4" />} />
          <ToolToggle value="node" label="Node — edit control points / delete fragments" icon={<SplineIcon className="h-4 w-4" />} />
          <ToolToggle value="select" label="Select / Move — transform whole shapes" icon={<MousePointer2 className="h-4 w-4" />} />
        </ToggleGroup>

        <Separator orientation="vertical" className="h-6" />

        {/* Brush settings (mode-aware) */}
        {brush.mode === "draw" && (
          <div className="flex items-center gap-3 flex-wrap">
            <SliderSetting
              label="Stroke"
              icon={<Pen className="h-3 w-3" />}
              value={brush.drawStrokeWidth}
              min={1}
              max={20}
              step={0.5}
              onChange={(v) => setBrush({ drawStrokeWidth: v })}
              unit="px"
            />
            <SliderSetting
              label="Line Boil"
              value={brush.drawStrokeJitter}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setBrush({ drawStrokeJitter: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderSetting
              label="Variance"
              value={brush.drawStrokeVariance}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setBrush({ drawStrokeVariance: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <label className="flex items-center gap-1.5 text-xs">
              <span>Fill</span>
              <input
                type="color"
                value={brush.fillColor}
                onChange={(e) => setBrush({ fillColor: e.target.value })}
                className="h-6 w-8 rounded border border-input bg-background cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={brush.autoClose}
                onChange={(e) => setBrush({ autoClose: e.target.checked })}
                className="rounded"
              />
              <span>Auto-close for fill</span>
            </label>
          </div>
        )}

        {brush.mode === "blob" && (
          <div className="flex items-center gap-3 flex-wrap">
            <SliderSetting
              label="Brush radius"
              icon={<CircleDot className="h-3 w-3" />}
              value={brush.blobBrushRadius}
              min={4}
              max={80}
              step={1}
              onChange={(v) => setBrush({ blobBrushRadius: v })}
              unit="px"
            />
            <label className="flex items-center gap-1.5 text-xs">
              <span>Fill</span>
              <input
                type="color"
                value={brush.fillColor}
                onChange={(e) => setBrush({ fillColor: e.target.value })}
                className="h-6 w-8 rounded border border-input bg-background cursor-pointer"
              />
            </label>
            <SliderSetting
              label="Outline"
              icon={<Pen className="h-3 w-3" />}
              value={brush.drawStrokeWidth}
              min={1}
              max={10}
              step={0.5}
              onChange={(v) => setBrush({ drawStrokeWidth: v })}
              unit="px"
            />
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Same-color strokes auto-merge into one solid fill block
            </span>
          </div>
        )}

        {brush.mode === "deform" && (
          <div className="flex items-center gap-3 flex-wrap">
            <SliderSetting
              label="Radius"
              value={brush.deformRadius}
              min={10}
              max={300}
              step={5}
              onChange={(v) => setBrush({ deformRadius: v })}
              unit="px"
            />
            <SliderSetting
              label="Strength"
              value={brush.deformStrength}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(v) => setBrush({ deformStrength: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            {/* Deform scope toggle: local (single sub-layer) vs global (entire parent layer) */}
            <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
              <ScopeToggle
                active={brush.deformScope === "local"}
                onClick={() => setBrush({ deformScope: "local" })}
                label="Local"
                hint="Deform only the sub-layer under cursor"
                icon={<Crosshair className="h-3.5 w-3.5" />}
              />
              <ScopeToggle
                active={brush.deformScope === "global"}
                onClick={() => setBrush({ deformScope: "global" })}
                label="Global"
                hint="Deform entire parent layer (e.g., Cara + all sub-layers)"
                icon={<Globe className="h-3.5 w-3.5" />}
              />
            </div>
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Use [ ] keys to adjust radius · scroll wheel to zoom
            </span>
          </div>
        )}

        {brush.mode === "knife" && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={brush.knifeAutoClose}
                onChange={(e) =>
                  setBrush({ knifeAutoClose: e.target.checked })
                }
                className="rounded"
              />
              <span>Auto-close cut path</span>
            </label>
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Draw across a closed shape to slice it. Each piece becomes
              independent — switch to Node tool to recolor / delete.
            </span>
          </div>
        )}

        {brush.mode === "node" && (
          <div className="flex items-center gap-3 flex-wrap">
            <SliderSetting
              label="Snap radius"
              icon={<Crosshair className="h-3 w-3" />}
              value={brush.nodeSnapRadius}
              min={4}
              max={40}
              step={1}
              onChange={(v) => setBrush({ nodeSnapRadius: v })}
              unit="px"
            />
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Click a shape to reveal its nodes · drag to move · Delete to
              remove node or shape
            </span>
          </div>
        )}

        {brush.mode === "select" && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Drag = move · Shift-drag = scale · Alt-drag = rotate · Drag empty =
              marquee
            </span>
          </div>
        )}

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1 rounded-md border border-input p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  // Read the live zoom from the store so rapid clicks accumulate
                  // instead of all using the same closure-captured value.
                  const cur = useRotoStore.getState().view.zoom;
                  setView({ zoom: Math.max(0.1, cur / 1.2) });
                }}
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom out (scroll wheel down)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={resetView}
                className="h-7 px-2 rounded text-xs font-mono tabular-nums hover:bg-accent"
                title="Reset view to fit (press 0)"
              >
                {Math.round(view.zoom * 100)}%
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Reset view to fit (press 0)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  const cur = useRotoStore.getState().view.zoom;
                  setView({ zoom: Math.min(16, cur * 1.2) });
                }}
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom in (scroll wheel up)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={resetView}
                aria-label="Reset view"
              >
                <Maximize className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Reset view (fit canvas) · also press 0
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* File ops */}
        <div className="flex items-center gap-1">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
            }}
          />
          <TooltipButton label="New project" onClick={() => onNewProject()}>
            <Plus className="h-4 w-4" />
          </TooltipButton>
          <TooltipButton
            label="Import project JSON"
            onClick={() => importInputRef.current?.click()}
          >
            <FolderOpen className="h-4 w-4" />
          </TooltipButton>
          <TooltipButton label="Export project JSON" onClick={handleExport}>
            <Save className="h-4 w-4" />
          </TooltipButton>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ScopeToggle({
  active,
  onClick,
  label,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors
            ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
        >
          {icon}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function ToolToggle({
  value,
  label,
  icon,
}: {
  value: ToolMode;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToggleGroupItem
          value={value}
          aria-label={label}
          className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        >
          {icon}
        </ToggleGroupItem>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function TooltipButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" variant="ghost" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SliderSetting({
  label,
  icon,
  value,
  min,
  max,
  step,
  onChange,
  unit,
  format,
}: {
  label: string;
  icon?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </Label>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        className="w-20"
      />
      <span className="text-xs font-mono w-12">
        {format ? format(value) : `${value}${unit ?? ""}`}
      </span>
    </div>
  );
}
