"use client";
import React, { useRef, useEffect } from "react";
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

// Dnešní datum jako YYYY-MM-DD v UTC — konzistentní s tím jak jsou data uložena
function getTodayKey(): string {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
}

interface ExpediceTimelineProps {
  days: ExpediceDay[];
  selectedItemKey: string | null;   // formát: "{sourceType}-{id}"
  onSelectItem: (item: ExpediceItem) => void;
  onClickEmpty: () => void;          // klik na prázdný prostor → deselect
  density: "detail" | "standard" | "compact";
}

export function ExpediceTimeline({
  days, selectedItemKey, onSelectItem, onClickEmpty, density,
}: ExpediceTimelineProps) {
  const todayRef = useRef<HTMLDivElement>(null);
  const today    = getTodayKey();
  const gap = density === "compact" ? 3 : 5;

  // Scroll na dnešní den při prvním renderu
  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
        const isToday = day.date === today;
        const dow     = CS_DAYS[utcDayOfWeek(day.date)];
        const dayNum  = utcDayNum(day.date);
        const month   = CS_MONTHS[utcMonthNum(day.date)];

        return (
          <div key={day.date} ref={isToday ? todayRef : undefined} style={{ marginBottom: 20 }}>
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
                    density={density}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
