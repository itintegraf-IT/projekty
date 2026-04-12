"use client";
import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import type { ExpediceDay, ExpediceItem } from "@/lib/expediceTypes";
import { ExpediceCard } from "./ExpediceCard";

const CS_DAYS   = ["ne", "po", "út", "st", "čt", "pá", "so"];
const CS_MONTHS = ["ledna","února","března","dubna","května","června","července","srpna","září","října","listopadu","prosince"];

function utcDayOfWeek(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}
function utcDayNum(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDate();
}
function utcMonthNum(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCMonth();
}

function getTodayKey(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
}

export interface ExpediceTimelineHandle {
  scrollToToday: () => void;
  scrollToDate: (dateKey: string) => void;
}

interface ExpediceTimelineProps {
  days: ExpediceDay[];
  selectedItemKey: string | null;
  onSelectItem: (item: ExpediceItem) => void;
  onDoubleClickItem?: (item: ExpediceItem) => void;
  onClickEmpty: () => void;
  density: "detail" | "standard" | "compact";
  // Drag & drop
  isEditor?: boolean;
  draggedItem?: ExpediceItem | null;
  onDragStartItem?: (item: ExpediceItem) => void;
  onDragEndItem?: () => void;
  onDropOnDay?: (targetDate: string, beforeItemKey: string | null) => void;
}

export const ExpediceTimeline = forwardRef<ExpediceTimelineHandle, ExpediceTimelineProps>(
  function ExpediceTimeline({
    days, selectedItemKey, onSelectItem, onDoubleClickItem, onClickEmpty, density,
    isEditor, draggedItem, onDragStartItem, onDragEndItem, onDropOnDay,
  }: ExpediceTimelineProps, ref) {
  const todayRef = useRef<HTMLDivElement>(null);
  const dateRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useImperativeHandle(ref, () => ({
    scrollToToday: () => {
      todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    scrollToDate: (dateKey: string) => {
      const el = dateRefs.current[dateKey];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
  }));
  const today    = getTodayKey();
  const gap      = density === "compact" ? 3 : 5;

  // Drag state — který den je highlighted + před jakou kartou se bude vložit
  const [dragOverDate,     setDragOverDate    ] = useState<string | null>(null);
  const [insertBeforeKey,  setInsertBeforeKey ] = useState<string | null>(null);

  // Reset drag stavu když draggedItem zmizí (dragEnd nebo optimistický update)
  useEffect(() => {
    if (!draggedItem) {
      setDragOverDate(null);
      setInsertBeforeKey(null);
    }
  }, [draggedItem]);

  // Scroll na dnešní den při prvním renderu
  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const canDrop = isEditor && !!onDropOnDay && !!draggedItem;

  return (
    <div
      style={{ flex: 1, overflowY: "auto", padding: "8px 16px 48px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClickEmpty(); }}
    >
      {days.length === 0 && (
        <div style={{
          padding: "48px 0", textAlign: "center",
          color: "var(--text-muted)", fontSize: 13,
        }}>
          V tomto období nejsou žádné položky k expedici.
        </div>
      )}

      {days.map((day) => {
        const isToday    = day.date === today;
        const isDragOver = dragOverDate === day.date;
        const dow        = CS_DAYS[utcDayOfWeek(day.date)];
        const dayNum     = utcDayNum(day.date);
        const month      = CS_MONTHS[utcMonthNum(day.date)];

        return (
          <div
            key={day.date}
            ref={(el) => {
              dateRefs.current[day.date] = el;
              if (isToday) (todayRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            style={{
              marginBottom: 20,
              borderRadius: isDragOver ? 10 : undefined,
              outline: isDragOver ? "2px solid rgba(59,130,246,0.5)" : undefined,
              transition: "outline 80ms ease-out",
            }}
            // Drop zone — celý den
            onDragOver={canDrop ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverDate(day.date);
            } : undefined}
            onDragEnter={canDrop ? (e) => {
              e.preventDefault();
              setDragOverDate(day.date);
            } : undefined}
            onDragLeave={canDrop ? (e) => {
              // Vyčistit jen pokud opouštíme celý den (ne přechod mezi dětmi)
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverDate(null);
                setInsertBeforeKey(null);
              }
            } : undefined}
            onDrop={canDrop ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const before = dragOverDate === day.date ? insertBeforeKey : null;
              setDragOverDate(null);
              setInsertBeforeKey(null);
              onDropOnDay(day.date, before);
            } : undefined}
            onClick={(e) => { if (e.target === e.currentTarget) onClickEmpty(); }}
          >
            {/* Sticky denní header */}
            <div style={{
              position: "sticky", top: 0, zIndex: 10,
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 0 6px",
              background: "var(--bg)",
              borderBottom: `1px solid ${isToday ? "rgba(59,130,246,0.35)" : "var(--border)"}`,
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: isToday ? "#3b82f6" : "var(--text-muted)",
              }}>
                {dow}
              </span>
              <span style={{ fontSize: 18, fontWeight: 700, color: isToday ? "#3b82f6" : "var(--text)" }}>
                {dayNum}
              </span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{month}</span>
              {isToday && (
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: "1px 7px",
                  borderRadius: 10, letterSpacing: "0.04em",
                  background: "rgba(59,130,246,0.18)", color: "#3b82f6",
                }}>
                  Dnes
                </span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" }}>
                {day.items.length} {
                  day.items.length === 1 ? "položka" :
                  day.items.length < 5 ? "položky" : "položek"
                }
              </span>
            </div>

            {/* Karty dne */}
            <div style={{ display: "flex", flexDirection: "column", gap }}>
              {day.items.map((item) => {
                const key = `${item.sourceType}-${item.id}`;
                return (
                  <ExpediceCard
                    key={key}
                    item={item}
                    selected={selectedItemKey === key}
                    onClick={() => onSelectItem(item)}
                    onDoubleClick={onDoubleClickItem ? () => onDoubleClickItem(item) : undefined}
                    density={density}
                    // Drag & drop
                    draggable={isEditor}
                    isDragging={draggedItem?.id === item.id && draggedItem?.sourceType === item.sourceType}
                    insertIndicator={isDragOver && insertBeforeKey === key}
                    onDragStartCard={onDragStartItem ? () => onDragStartItem(item) : undefined}
                    onDragEndCard={onDragEndItem}
                    onDragEnterCard={canDrop ? () => setInsertBeforeKey(key) : undefined}
                  />
                );
              })}

              {/* Drop indikátor na konci dne */}
              {isDragOver && insertBeforeKey === null && (
                <div style={{
                  height: 2, borderRadius: 1,
                  background: "rgba(59,130,246,0.6)",
                  margin: "2px 0",
                }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});

