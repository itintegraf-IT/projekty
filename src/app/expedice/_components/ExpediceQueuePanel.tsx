"use client";
import React, { useState } from "react";
import type { ExpediceItem, ExpediceManualItem } from "@/lib/expediceTypes";

const KIND_LABELS = {
  MANUAL_JOB: "RUČNÍ",
  INTERNAL_TRANSFER: "INTERNÍ",
} as const;

const KIND_BADGE_STYLE: Record<string, React.CSSProperties> = {
  MANUAL_JOB:        { background: "rgba(34,197,94,0.15)",  color: "#22c55e" },
  INTERNAL_TRANSFER: { background: "rgba(249,115,22,0.15)", color: "#f97316" },
};

interface ExpediceQueuePanelProps {
  items: ExpediceManualItem[];
  selectedKey: string | null;
  onSelectItem: (item: ExpediceManualItem) => void;
  // Drag & drop
  draggedItem?: ExpediceItem | null;
  onDragStartItem?: (item: ExpediceItem) => void;
  onDragEndItem?: () => void;
  onDropOnQueue?: () => void;
}

export function ExpediceQueuePanel({
  items, selectedKey, onSelectItem,
  draggedItem, onDragStartItem, onDragEndItem, onDropOnQueue,
}: ExpediceQueuePanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Může být tato fronta drop target? Jen pro manual item který je naplánovaný (má datum)
  const canReceiveDrop =
    !!onDropOnQueue &&
    draggedItem?.sourceType === "manual" &&
    !!draggedItem.date; // je naplánovaný, lze vrátit do fronty

  return (
    <div
      onDragOver={canReceiveDrop ? (e) => { e.preventDefault(); setIsDragOver(true); } : undefined}
      onDragEnter={canReceiveDrop ? (e) => { e.preventDefault(); setIsDragOver(true); } : undefined}
      onDragLeave={canReceiveDrop ? (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
      } : undefined}
      onDrop={canReceiveDrop ? (e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropOnQueue();
      } : undefined}
      style={{
        borderRadius: 8,
        outline: isDragOver
          ? "2px dashed rgba(59,130,246,0.5)"
          : canReceiveDrop ? "2px dashed rgba(255,255,255,0.1)" : undefined,
        background: isDragOver ? "rgba(59,130,246,0.05)" : undefined,
        transition: "all 80ms ease-out",
        minHeight: canReceiveDrop ? 64 : undefined,
        padding: canReceiveDrop ? "4px" : undefined,
      }}
    >
      {items.length === 0 ? (
        <div style={{
          fontSize: 12, color: isDragOver ? "#3b82f6" : "var(--text-muted)",
          padding: "12px 4px", lineHeight: 1.5,
          textAlign: canReceiveDrop ? "center" : undefined,
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: canReceiveDrop ? 40 : undefined,
        }}>
          {isDragOver
            ? "Pustit pro vrácení do fronty"
            : canReceiveDrop
              ? "↓ Sem vrátit do fronty"
              : "Fronta je prázdná — přidej ruční položku přes builder výše."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {items.map((item) => {
            const key = `manual-${item.id}`;
            const isSelected = selectedKey === key;
            return (
              <QueueCard
                key={item.id}
                item={item}
                selected={isSelected}
                onClick={() => onSelectItem(item)}
                isDragging={draggedItem?.sourceType === "manual" && draggedItem?.id === item.id}
                onDragStart={onDragStartItem ? () => onDragStartItem(item) : undefined}
                onDragEnd={onDragEndItem}
              />
            );
          })}
          {isDragOver && (
            <div style={{
              padding: "10px 0", textAlign: "center",
              fontSize: 11, color: "#3b82f6",
              border: "1px dashed rgba(59,130,246,0.35)",
              borderRadius: 7,
            }}>
              Pustit pro vrácení do fronty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QueueCard({
  item,
  selected,
  onClick,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  item: ExpediceManualItem;
  selected: boolean;
  onClick: () => void;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const badgeStyle = KIND_BADGE_STYLE[item.itemKind] ?? {};

  return (
    <div
      draggable={!!onDragStart}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStart={onDragStart ? (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `manual-${item.id}`);
        onDragStart();
      } : undefined}
      onDragEnd={onDragEnd}
      style={{
        padding: "7px 10px", borderRadius: 8,
        background: selected
          ? "rgba(59,130,246,0.1)"
          : hovered ? "rgba(255,255,255,0.04)" : "var(--surface)",
        border: `1px solid ${selected ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.07)"}`,
        cursor: onDragStart ? (isDragging ? "grabbing" : "grab") : "pointer",
        minWidth: 0,
        opacity: isDragging ? 0.45 : 1,
        display: "flex", flexDirection: "column", gap: 3,
        transition: "all 120ms ease-out",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
          padding: "1px 5px", borderRadius: 4, flexShrink: 0,
          ...badgeStyle,
        }}>
          {KIND_LABELS[item.itemKind] ?? item.itemKind}
        </span>
        {item.orderNumber && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }}>
            {item.orderNumber}
          </span>
        )}
      </div>
      {item.description && (
        <div style={{
          fontSize: 10, color: "var(--text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {item.description}
        </div>
      )}
    </div>
  );
}
