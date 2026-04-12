"use client";
import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from "react";
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
  onSelectItem?: (item: ExpediceItem) => void;
  onDoubleClickItem?: (item: ExpediceItem) => void;
  onClickEmpty: () => void;
  // Drag & drop
  isEditor?: boolean;
  draggedItem?: ExpediceItem | null;
  onDragStartItem?: (item: ExpediceItem) => void;
  onDragEndItem?: () => void;
  onDropOnDay?: (targetDate: string, beforeItemKey: string | null) => void;
}

export const ExpediceTimeline = forwardRef<ExpediceTimelineHandle, ExpediceTimelineProps>(
  function ExpediceTimeline({
    days, selectedItemKey, onSelectItem, onDoubleClickItem, onClickEmpty,
    isEditor, draggedItem, onDragStartItem, onDragEndItem, onDropOnDay,
  }: ExpediceTimelineProps, ref) {

  const todayRef  = useRef<HTMLDivElement>(null);
  const dateRefs  = useRef<Record<string, HTMLDivElement | null>>({});
  // Ref na DOM elementy jednotlivých karet — klíč = "sourceType-id"
  const cardRefs  = useRef<Record<string, HTMLElement | null>>({});

  useImperativeHandle(ref, () => ({
    scrollToToday: () => {
      todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    scrollToDate: (dateKey: string) => {
      const el = dateRefs.current[dateKey];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }));

  const today = getTodayKey();
  const GAP   = 8; // mezera mezi kartami v px

  const [dragOverDate,    setDragOverDate   ] = useState<string | null>(null);
  const [insertBeforeKey, setInsertBeforeKey] = useState<string | null>(null);

  useEffect(() => {
    if (!draggedItem) {
      setDragOverDate(null);
      setInsertBeforeKey(null);
    }
  }, [draggedItem]);

  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const canDrop = isEditor && !!onDropOnDay && !!draggedItem;

  /**
   * Klíčová funkce: porovná clientY s pozicemi karet a vrátí,
   * PŘED kterou kartou se má vložit (nebo null = na konec).
   * Pracuje přímo s DOM — žádná závislost na React state.
   */
  const computeInsertKey = useCallback((clientY: number, dayItems: ExpediceItem[]): string | null => {
    const draggedKey = draggedItem ? `${draggedItem.sourceType}-${draggedItem.id}` : null;
    for (const item of dayItems) {
      const key = `${item.sourceType}-${item.id}`;
      if (key === draggedKey) continue; // přeskoč draggovanou kartu
      const el = cardRefs.current[key];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      // Kurzor nad středem karty → vlož před ní
      if (clientY < rect.top + rect.height / 2) {
        return key;
      }
    }
    return null; // vlož na konec
  }, [draggedItem]);

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
        const isToday   = day.date === today;
        const isDragOver = dragOverDate === day.date;
        const dowIndex  = utcDayOfWeek(day.date);
        const isWeekend = dowIndex === 0 || dowIndex === 6;
        const dow       = CS_DAYS[dowIndex];
        const dayNum    = utcDayNum(day.date);
        const month     = CS_MONTHS[utcMonthNum(day.date)];

        return (
          <div
            key={day.date}
            ref={(el) => {
              dateRefs.current[day.date] = el;
              if (isToday) (todayRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
            }}
            style={{
              marginBottom: 20,
              borderRadius: isWeekend ? 8 : isDragOver ? 10 : undefined,
              background: isWeekend ? "rgba(251,146,60,0.11)" : undefined,
              outline: isDragOver ? "2px solid rgba(59,130,246,0.5)" : undefined,
              transition: "outline 80ms ease-out",
            }}
            // ── Jeden onDragOver na celý den ──────────────────────────────────
            // Žádné stopPropagation v children — všechny dragover eventy
            // bublají sem. clientY porovnáme s pozicemi karet přes refs.
            onDragOver={canDrop ? (e) => {
              e.preventDefault();
              setDragOverDate(day.date);
              const newKey = computeInsertKey(e.clientY, day.items);
              if (newKey !== insertBeforeKey) {
                setInsertBeforeKey(newKey);
              }
            } : undefined}
            onDragEnter={canDrop ? (e) => {
              e.preventDefault();
              setDragOverDate(day.date);
            } : undefined}
            onDragLeave={canDrop ? (e) => {
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
              background: isWeekend ? "rgba(251,146,60,0.11)" : "var(--bg)",
              borderBottom: `1px solid ${isToday ? "rgba(59,130,246,0.35)" : isWeekend ? "rgba(251,146,60,0.55)" : "var(--border)"}`,
              marginBottom: 8,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: isToday ? "#3b82f6" : isWeekend ? "#fca5a5" : "var(--text-muted)",
              }}>
                {dow}
              </span>
              <span style={{ fontSize: 18, fontWeight: 700, color: isToday ? "#3b82f6" : isWeekend ? "#f87171" : "var(--text)" }}>
                {dayNum}
              </span>
              <span style={{ fontSize: 13, color: isWeekend && !isToday ? "#fca5a5" : "var(--text-muted)" }}>{month}</span>
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

            {/* Karty dne — statický layout, bez animací během drag */}
            <div style={{ display: "flex", flexDirection: "column", gap: GAP, minHeight: 56 }}>
              {day.items.map((item) => {
                const key = `${item.sourceType}-${item.id}`;
                const isDraggingThis = draggedItem?.id === item.id && draggedItem?.sourceType === item.sourceType;
                const showIndicator  = isDragOver && insertBeforeKey === key && !isDraggingThis;

                return (
                  <div
                    key={key}
                    ref={(el) => { cardRefs.current[key] = el; }}
                    style={{ position: "relative" }}
                  >
                    {/* Tenká modrá čára PŘED kartou — absolutně pozicovaná, bez layout shift */}
                    {showIndicator && (
                      <div style={{
                        position: "absolute",
                        top: -(GAP / 2) - 1,
                        left: 0, right: 0,
                        height: 2,
                        borderRadius: 1,
                        background: "#3b82f6",
                        boxShadow: "0 0 6px rgba(59,130,246,0.6)",
                        zIndex: 10,
                        pointerEvents: "none",
                      }} />
                    )}
                    <ExpediceCard
                      item={item}
                      selected={selectedItemKey === key}
                      onClick={onSelectItem ? () => onSelectItem(item) : undefined}
                      onDoubleClick={onDoubleClickItem ? () => onDoubleClickItem(item) : undefined}
                      draggable={isEditor}
                      isDragging={isDraggingThis}
                      onDragStartCard={onDragStartItem ? () => onDragStartItem(item) : undefined}
                      onDragEndCard={onDragEndItem}
                    />
                  </div>
                );
              })}

              {/* Indikátor na konci dne */}
              {isDragOver && insertBeforeKey === null && (
                <div style={{
                  height: 2, borderRadius: 1,
                  background: "#3b82f6",
                  boxShadow: "0 0 6px rgba(59,130,246,0.6)",
                  pointerEvents: "none",
                }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
