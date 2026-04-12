"use client";
import React, { useState, useEffect, useCallback } from "react";
import type { ExpediceData, ExpediceItem } from "@/lib/expediceTypes";
import { ExpediceTimeline } from "./ExpediceTimeline";
import { ExpediceAside } from "./ExpediceAside";

type Density  = "detail" | "standard" | "compact";
type DaysRange = 7 | 14 | 30;
type Filter   = "all" | "block" | "manual" | "internal";

const DENSITY_LS_KEY = "expedice_density";
const DAYS_BACK = 3;

interface ExpedicePageProps {
  role: string;
}

export function ExpedicePage({ role }: ExpedicePageProps) {
  const isEditor = ["ADMIN", "PLANOVAT"].includes(role);

  const [data,     setData    ] = useState<ExpediceData | null>(null);
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState<string | null>(null);
  const [daysAhead, setDaysAhead] = useState<DaysRange>(14);
  const [density,  setDensity ] = useState<Density>("standard");
  const [filter,   setFilter  ] = useState<Filter>("all");
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);

  // Načíst hustotu z localStorage po hydrataci
  useEffect(() => {
    const stored = localStorage.getItem(DENSITY_LS_KEY);
    if (stored === "detail" || stored === "standard" || stored === "compact") {
      setDensity(stored);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/expedice?daysBack=${DAYS_BACK}&daysAhead=${daysAhead}`);
      if (!res.ok) throw new Error("Chyba serveru");
      const json: ExpediceData = await res.json();
      setData(json);
    } catch {
      setError("Nepodařilo se načíst expediční plán.");
    } finally {
      setLoading(false);
    }
  }, [daysAhead]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  async function handlePublish(blockId: number) {
    const res = await fetch(`/api/blocks/${blockId}/expedition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? "Chyba při zaplánování");
    }
    await fetchData();
  }

  function handleSelectItem(item: ExpediceItem) {
    const key = `${item.sourceType}-${item.id}`;
    setSelectedItemKey((prev) => (prev === key ? null : key));
  }

  function handleChangeDensity(d: Density) {
    setDensity(d);
    localStorage.setItem(DENSITY_LS_KEY, d);
  }

  // Aplikovat filtr na dny
  // Při filtru "all" zobrazovat i prázdné dny (vidíš kdy nic neexpeduje)
  // U specifických filtrů skrýt dny bez odpovídajících položek
  const filteredDays = (data?.days ?? []).map((day) => ({
    ...day,
    items: day.items.filter((item) => {
      if (filter === "all")      return true;
      if (filter === "block")    return item.sourceType === "block";
      if (filter === "manual")   return item.sourceType === "manual" && item.itemKind === "MANUAL_JOB";
      if (filter === "internal") return item.sourceType === "manual" && item.itemKind === "INTERNAL_TRANSFER";
      return true;
    }),
  })).filter((day) => filter === "all" || day.items.length > 0);

  // ─── Styly ────────────────────────────────────────────────────────────────

  const navBtnStyle = (active: boolean): React.CSSProperties => ({
    height: 26, padding: "0 10px", borderRadius: 6, fontSize: 11,
    fontWeight: 500, cursor: "pointer", border: "none", outline: "none",
    background: active ? "rgba(59,130,246,0.18)" : "transparent",
    color: active ? "#3b82f6" : "var(--text-muted)",
    transition: "all 120ms ease-out",
  });

  const divider: React.CSSProperties = {
    width: 1, height: 16, background: "var(--border)", flexShrink: 0,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: "var(--bg)", color: "var(--text)",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 16px", height: 48, flexShrink: 0,
        borderBottom: "1px solid var(--border)",
      }}>
        <a href="/" style={{
          fontSize: 12, color: "var(--text-muted)", textDecoration: "none",
          display: "flex", alignItems: "center", gap: 4,
          transition: "color 120ms ease-out",
        }}>
          ← Výrobní plán
        </a>
        <div style={divider} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Expediční plán</span>

        <div style={{ flex: 1 }} />

        {/* Filtry */}
        {(["all", "block", "manual", "internal"] as Filter[]).map((f) => {
          const labels: Record<Filter, string> = {
            all: "Vše", block: "Tiskový plán", manual: "Ruční", internal: "Interní",
          };
          return (
            <button key={f} onClick={() => setFilter(f)} style={navBtnStyle(filter === f)}>
              {labels[f]}
            </button>
          );
        })}

        <div style={divider} />

        {/* Rozsah dnů */}
        {([7, 14, 30] as DaysRange[]).map((d) => (
          <button key={d} onClick={() => setDaysAhead(d)} style={navBtnStyle(daysAhead === d)}>
            {d} dní
          </button>
        ))}

        <div style={divider} />

        {/* Hustota */}
        {([["detail", "Detail"], ["standard", "Standard"], ["compact", "Kompaktní"]] as [Density, string][]).map(([d, label]) => (
          <button key={d} onClick={() => handleChangeDensity(d)} style={navBtnStyle(density === d)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tělo ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {loading ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-muted)", fontSize: 13,
          }}>
            Načítám...
          </div>
        ) : error ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 12,
          }}>
            <span style={{ color: "#ef4444", fontSize: 13 }}>{error}</span>
            <button
              onClick={() => { setLoading(true); fetchData(); }}
              style={{
                fontSize: 12, padding: "6px 16px", borderRadius: 8, cursor: "pointer",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              Zkusit znovu
            </button>
          </div>
        ) : (
          <>
            <ExpediceTimeline
              days={filteredDays}
              selectedItemKey={selectedItemKey}
              onSelectItem={handleSelectItem}
              onClickEmpty={() => setSelectedItemKey(null)}
              density={density}
            />
            {isEditor && data && (
              <ExpediceAside
                candidates={data.candidates}
                onPublish={handlePublish}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
