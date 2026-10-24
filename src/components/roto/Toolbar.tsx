"use client";

import {
  Pen,
  Spline,
  MousePointer2,
  Eye,
  Layers,
  Save,
  FolderOpen,
  Film,
  Plus,
  Undo2,
  Redo2,
  Settings2,
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
import type { ToolMode } from "@/lib/roto/types";

interface Props {
  onNewProject: () => void;
}

export function Toolbar({ onNewProject }: Props) {
  const project = useRotoStore((s) => s.project);
  const brush = useRotoStore((s) => s.brush);
  const setTool = useRotoStore((s) => s.setTool);
  const setBrush = useRotoStore((s) => s.setBrush);
  const setProjectName = useRotoStore((s) => s.setProjectName);
  const loadProject = useRotoStore((s) => s.loadProject);
  const resetProject = useRotoStore((s) => s.resetProject);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
          <ToolToggle value="draw" label="Draw Brush" icon={<Pen className="h-4 w-4" />} />
          <ToolToggle value="deform" label="Deform / Liquify" icon={<Spline className="h-4 w-4" />} />
          <ToolToggle value="select" label="Select / Move" icon={<MousePointer2 className="h-4 w-4" />} />
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
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Scroll on canvas to adjust radius
            </span>
          </div>
        )}

        {brush.mode === "select" && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-muted/50">
              Drag = move · Shift-drag = scale · Alt-drag = rotate · Drag empty = marquee
            </span>
          </div>
        )}

        <div className="flex-1" />

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
          <TooltipButton label="Import project JSON" onClick={() => importInputRef.current?.click()}>
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
      <TooltipContent>{label}</TooltipContent>
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
