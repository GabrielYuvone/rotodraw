"use client";

import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Pen,
  Square,
  Circle,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRotoStore } from "@/lib/roto/store";
import type { SubLayer } from "@/lib/roto/types";

const KIND_META: Record<
  SubLayer["kind"],
  { icon: typeof Pen; label: string; color: string }
> = {
  outline: { icon: Pen, label: "Outline", color: "#000000" },
  fill: { icon: Square, label: "Fill", color: "#3b6fb5" },
  shadow: { icon: Circle, label: "Shadow", color: "#1f3a5f" },
  highlight: { icon: Sparkles, label: "Highlight", color: "#e8b87a" },
  custom: { icon: Pen, label: "Custom", color: "#6b7280" },
};

function LayerHeader({
  layer,
  collapsed,
  onToggle,
}: {
  layer: ReturnType<typeof useRotoStore.getState>["project"]["layers"][number];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const toggleVisible = useRotoStore((s) => s.toggleLayerVisible);
  const toggleLocked = useRotoStore((s) => s.toggleLayerLocked);
  const deleteLayer = useRotoStore((s) => s.deleteLayer);
  const reorderLayer = useRotoStore((s) => s.reorderLayer);
  const renameLayer = useRotoStore((s) => s.renameLayer);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);

  return (
    <div className="flex items-center gap-1 group">
      <button
        onClick={onToggle}
        className="p-1 rounded hover:bg-accent text-muted-foreground"
        aria-label={collapsed ? "Expand layer" : "Collapse layer"}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {editing ? (
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            renameLayer(layer.id, name || layer.name);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              renameLayer(layer.id, name || layer.name);
              setEditing(false);
            }
          }}
          className="h-6 text-sm py-0"
          autoFocus
        />
      ) : (
        <button
          onDoubleClick={() => setEditing(true)}
          className="flex items-center gap-1.5 flex-1 text-left text-sm font-medium"
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: layer.color ?? "#888" }}
          />
          {layer.name}
          <span className="text-xs text-muted-foreground">
            ({layer.subLayers.length})
          </span>
        </button>
      )}

      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
        <IconBtn
          label="Move up"
          onClick={() => reorderLayer(layer.id, -1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          label="Move down"
          onClick={() => reorderLayer(layer.id, 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          label={layer.locked ? "Unlock layer" : "Lock layer"}
          onClick={() => toggleLocked(layer.id)}
          active={layer.locked}
        >
          {layer.locked ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <Unlock className="h-3.5 w-3.5" />
          )}
        </IconBtn>
        <IconBtn
          label={layer.visible ? "Hide layer" : "Show layer"}
          onClick={() => toggleVisible(layer.id)}
          active={!layer.visible}
        >
          {layer.visible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </IconBtn>
        <IconBtn
          label="Delete layer"
          onClick={() => deleteLayer(layer.id)}
          danger
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  active,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`p-1 rounded hover:bg-accent text-muted-foreground transition-colors
            ${active ? "text-foreground bg-accent" : ""}
            ${danger ? "hover:text-destructive" : ""}`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function LayerManager() {
  const layers = useRotoStore((s) => s.project.layers);
  const activeSubLayerId = useRotoStore((s) => s.project.activeSubLayerId);
  const setActiveSubLayer = useRotoStore((s) => s.setActiveSubLayer);
  const addLayer = useRotoStore((s) => s.addLayer);
  const addSubLayer = useRotoStore((s) => s.addSubLayer);
  const toggleSubLayerVisible = useRotoStore((s) => s.toggleSubLayerVisible);
  const toggleSubLayerLocked = useRotoStore((s) => s.toggleSubLayerLocked);
  const deleteSubLayer = useRotoStore((s) => s.deleteSubLayer);
  const reorderSubLayer = useRotoStore((s) => s.reorderSubLayer);
  const renameSubLayer = useRotoStore((s) => s.renameSubLayer);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h3 className="text-sm font-semibold">Layers</h3>
          <Button size="sm" variant="ghost" onClick={() => addLayer()}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Layer
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-2">
            {layers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No layers. Click "+ Layer" to start.
              </p>
            )}
            {layers.map((layer) => {
              const isCollapsed = collapsed[layer.id];
              return (
                <div
                  key={layer.id}
                  className="rounded-md border bg-card/50 hover:bg-card/80"
                >
                  <LayerHeader
                    layer={layer}
                    collapsed={!!isCollapsed}
                    onToggle={() =>
                      setCollapsed((c) => ({
                        ...c,
                        [layer.id]: !c[layer.id],
                      }))
                    }
                  />
                  {!isCollapsed && (
                    <div className="pb-1.5 pl-4 pr-1.5">
                      {layer.subLayers.map((sub) => {
                        const isActive = sub.id === activeSubLayerId;
                        const meta = KIND_META[sub.kind];
                        const Icon = meta.icon;
                        return (
                          <div
                            key={sub.id}
                            className={`flex items-center gap-1 group/sub pl-2 pr-1 py-1 rounded-sm cursor-pointer
                              ${
                                isActive
                                  ? "bg-primary/15 border border-primary/40"
                                  : "hover:bg-accent"
                              }
                              ${!sub.visible ? "opacity-40" : ""}`}
                            onClick={() => setActiveSubLayer(sub.id)}
                          >
                            <span
                              className="inline-flex items-center justify-center h-5 w-5 rounded-sm"
                              style={{
                                color: meta.color,
                                background: `${meta.color}1a`,
                              }}
                            >
                              <Icon className="h-3 w-3" />
                            </span>
                            <SubLayerNameEditor
                              value={sub.name}
                              onChange={(name) =>
                                renameSubLayer(layer.id, sub.id, name)
                              }
                            />
                            <div className="flex opacity-0 group-hover/sub:opacity-100 transition-opacity">
                              <IconBtn
                                label="Move up"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  reorderSubLayer(layer.id, sub.id, -1);
                                }}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </IconBtn>
                              <IconBtn
                                label="Move down"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  reorderSubLayer(layer.id, sub.id, 1);
                                }}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </IconBtn>
                              <IconBtn
                                label={
                                  sub.locked ? "Unlock" : "Lock"
                                }
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  toggleSubLayerLocked(layer.id, sub.id);
                                }}
                                active={sub.locked}
                              >
                                {sub.locked ? (
                                  <Lock className="h-3 w-3" />
                                ) : (
                                  <Unlock className="h-3 w-3" />
                                )}
                              </IconBtn>
                              <IconBtn
                                label={
                                  sub.visible ? "Hide" : "Show"
                                }
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  toggleSubLayerVisible(layer.id, sub.id);
                                }}
                                active={!sub.visible}
                              >
                                {sub.visible ? (
                                  <Eye className="h-3 w-3" />
                                ) : (
                                  <EyeOff className="h-3 w-3" />
                                )}
                              </IconBtn>
                              <IconBtn
                                label="Delete sub-layer"
                                onClick={(e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  deleteSubLayer(layer.id, sub.id);
                                }}
                                danger
                              >
                                <Trash2 className="h-3 w-3" />
                              </IconBtn>
                            </div>
                          </div>
                        );
                      })}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full justify-start mt-1 h-6 text-xs text-muted-foreground"
                        onClick={() => addSubLayer(layer.id)}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Sub-layer
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
        <Separator />
        <div className="p-2 text-[11px] text-muted-foreground leading-snug">
          <p>
            Double-click any name to rename. Hover a row for toolbar actions.
            Click a sub-layer to activate it for drawing.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SubLayerNameEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onChange(draft || value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onChange(draft || value);
            setEditing(false);
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-5 text-xs py-0 flex-1"
        onClick={(e) => e.stopPropagation()}
        autoFocus
      />
    );
  }
  return (
    <span
      className="flex-1 text-xs truncate"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
