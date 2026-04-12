"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import type { ExpediceData, ExpediceItem, ExpediceManualItem } from "@/lib/expediceTypes";
import { ExpediceTimeline, type ExpediceTimelineHandle } from "./ExpediceTimeline";
import { ExpediceAside, type AsidePanelMode } from "./ExpediceAside";
import DatePickerField from "@/app/_components/DatePickerField";

type DaysRange = 7 | 14 | 30;
type Filter   = "all" | "block" | "manual" | "internal";

const ASIDE_WIDTH_LS_KEY = "expedice_aside_width";
const ASIDE_MIN = 260;
const ASIDE_MAX = 500;
const ASIDE_DEFAULT = 320;
const DAYS_BACK = 3;

interface ExpedicePageProps {
  role: string;
}

// ─── Helpers pro sort order ───────────────────────────────────────────────────

function computeInsertSortOrder(
  items: ExpediceItem[],
  excludeKey: string,
  beforeItemKey: string | null
): number {
  const remaining = items.filter((i) => `${i.sourceType}-${i.id}` !== excludeKey);

  if (beforeItemKey === null || remaining.length === 0) {
    const last = remaining[remaining.length - 1];
    return (last?.expeditionSortOrder ?? 0) + 1000;
  }

  const targetIdx = remaining.findIndex(
    (i) => `${i.sourceType}-${i.id}` === beforeItemKey
  );
  if (targetIdx === -1) {
    const last = remaining[remaining.length - 1];
    return (last?.expeditionSortOrder ?? 0) + 1000;
  }

  if (targetIdx === 0) {
    return (remaining[0].expeditionSortOrder ?? 1000) - 500;
  }

  const prev = remaining[targetIdx - 1];
  const next = remaining[targetIdx];
  return Math.round(((prev.expeditionSortOrder ?? 0) + (next.expeditionSortOrder ?? 0)) / 2);
}

// ─── Optimistická aktualizace dat ────────────────────────────────────────────

function applyOptimisticMove(
  data: ExpediceData,
  draggedItem: ExpediceItem,
  targetDate: string | null,
  beforeItemKey: string | null,
  newSortOrder: number
): ExpediceData {
  // Shallow-deep clone (dny a položky jsou nové pole, ostatní zůstávají)
  const newData: ExpediceData = {
    days: data.days.map((d) => ({ date: d.date, items: [...d.items] })),
    candidates: data.candidates,
    queueItems: [...data.queueItems],
  };

  // 1. Odebrat z aktuální pozice
  for (const day of newData.days) {
    day.items = day.items.filter(
      (i) => !(i.id === draggedItem.id && i.sourceType === draggedItem.sourceType)
    );
  }
  if (draggedItem.sourceType === "manual") {
    newData.queueItems = newData.queueItems.filter((i) => i.id !== draggedItem.id);
  }

  // 2. Vytvořit aktualizovanou položku
  let updatedItem: ExpediceItem;
  if (draggedItem.sourceType === "block") {
    updatedItem = {
      ...draggedItem,
      deadlineExpedice: targetDate!,
      expeditionSortOrder: newSortOrder,
    };
  } else {
    updatedItem = {
      ...draggedItem,
      date: targetDate,
      expeditionSortOrder: targetDate ? newSortOrder : null,
    };
  }

  // 3. Vložit na cílovou pozici
  if (targetDate === null) {
    newData.queueItems = [updatedItem as ExpediceManualItem, ...newData.queueItems];
  } else {
    let targetDay = newData.days.find((d) => d.date === targetDate);
    if (!targetDay) {
      targetDay = { date: targetDate, items: [] };
      const insertIdx = newData.days.findIndex((d) => d.date > targetDate);
      if (insertIdx === -1) newData.days.push(targetDay);
      else newData.days.splice(insertIdx, 0, targetDay);
    }

    if (beforeItemKey === null) {
      targetDay.items.push(updatedItem);
    } else {
      const targetIdx = targetDay.items.findIndex(
        (i) => `${i.sourceType}-${i.id}` === beforeItemKey
      );
      if (targetIdx === -1) targetDay.items.push(updatedItem);
      else targetDay.items.splice(targetIdx, 0, updatedItem);
    }
  }

  return newData;
}

// ─── Komponenta ───────────────────────────────────────────────────────────────

export function ExpedicePage({ role }: ExpedicePageProps) {
  const isEditor = ["ADMIN", "PLANOVAT"].includes(role);

  // ─── Data ──────────────────────────────────────────────────────────────────
  const [data,      setData     ] = useState<ExpediceData | null>(null);
  const [loading,   setLoading  ] = useState(true);
  const [error,     setError    ] = useState<string | null>(null);
  const [daysAhead, setDaysAhead] = useState<DaysRange>(14);
  const [filter,    setFilter   ] = useState<Filter>("all");
  const [jumpDate,  setJumpDate ] = useState("");
  const [asideWidth, setAsideWidth] = useState<number>(ASIDE_DEFAULT);

  // ─── Panel state ───────────────────────────────────────────────────────────
  const [panelMode,    setPanelMode   ] = useState<AsidePanelMode>("builder");
  const [selectedItem, setSelectedItem] = useState<ExpediceItem | null>(null);
  const [isDirty,      setIsDirty     ] = useState(false);

  // ─── Drag state ────────────────────────────────────────────────────────────
  const [draggedItem, setDraggedItem] = useState<ExpediceItem | null>(null);

  // Pending switch pro dirty guard řízený v ExpediceAside
  const selectedKeyFor = (item: ExpediceItem | null) =>
    item ? `${item.sourceType}-${item.id}` : null;

  // ─── Načíst šířku aside z localStorage ────────────────────────────────────
  useEffect(() => {
    const storedWidth = localStorage.getItem(ASIDE_WIDTH_LS_KEY);
    if (storedWidth) {
      const n = Number(storedWidth);
      if (Number.isFinite(n) && n >= ASIDE_MIN && n <= ASIDE_MAX) {
        setAsideWidth(n);
      }
    }
  }, []);

  // ─── Fetch dat ─────────────────────────────────────────────────────────────
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

  // ─── Helpers pro refetch po akci ───────────────────────────────────────────
  const pendingSelectedIdRef = useRef<{ sourceType: string; id: number } | null>(null);
  const timelineRef = useRef<ExpediceTimelineHandle>(null);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(ASIDE_DEFAULT);

  async function refreshAndSelect(sourceType?: string, id?: number) {
    if (sourceType && id) {
      pendingSelectedIdRef.current = { sourceType, id };
    }
    await fetchData();
  }

  // Po refetchi obnovit selectedItem z nových dat (aby odrážel aktuální stav)
  const prevDataRef = useRef<ExpediceData | null>(null);
  useEffect(() => {
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    const pending = pendingSelectedIdRef.current;
    if (!pending) return;
    pendingSelectedIdRef.current = null;

    let found: ExpediceItem | null = null;
    if (pending.sourceType === "block") {
      for (const day of data.days) {
        const match = day.items.find((i) => i.sourceType === "block" && i.id === pending.id);
        if (match) { found = match; break; }
      }
    } else {
      for (const day of data.days) {
        const match = day.items.find((i) => i.sourceType === "manual" && i.id === pending.id);
        if (match) { found = match; break; }
      }
      if (!found) {
        const match = data.queueItems.find((i) => i.id === pending.id);
        if (match) found = match;
      }
    }

    if (found) setSelectedItem(found);
  }, [data]);

  // ─── Panel akce ────────────────────────────────────────────────────────────

  async function handlePublish(blockId: number) {
    const res = await fetch(`/api/blocks/${blockId}/expedition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? "Chyba při zaplánování");
    }
    await fetchData();
  }

  async function handleUnpublishFromDetail(blockId: number) {
    const res = await fetch(`/api/blocks/${blockId}/expedition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unpublish" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? "Chyba při odebrání z expedice");
    }
    setSelectedItem(null);
    setPanelMode("builder");
    setIsDirty(false);
    await fetchData();
  }

  function handleSelectItem(item: ExpediceItem) {
    setSelectedItem(item);
    setPanelMode("detail");
    setIsDirty(false);
  }

  function handleDoubleClickItem(item: ExpediceItem) {
    if (!isEditor) return;
    setSelectedItem(item);
    setPanelMode("edit");
    setIsDirty(false);
  }

  function handleClickEmpty() {
    if (!isEditor) return;
    if (!isDirty) {
      setSelectedItem(null);
      setPanelMode("builder");
    }
  }

  function handleSelectQueueItem(item: ExpediceManualItem) {
    setSelectedItem(item);
    setPanelMode("detail");
    setIsDirty(false);
  }

  function handleSwitchToEdit() { setPanelMode("edit"); }
  function handleSwitchToDetail() { setPanelMode("detail"); setIsDirty(false); }
  function handleSwitchToBuilder() { setPanelMode("builder"); setSelectedItem(null); setIsDirty(false); }

  async function handleSaved() {
    setIsDirty(false);
    if (selectedItem) {
      const srcType = selectedItem.sourceType;
      const id = selectedItem.id;
      setPanelMode("detail");
      await refreshAndSelect(srcType, id);
    } else {
      await fetchData();
      setPanelMode("builder");
    }
  }

  async function handleDeleted() {
    setSelectedItem(null);
    setPanelMode("builder");
    setIsDirty(false);
    await fetchData();
  }

  // ─── Resize aside ──────────────────────────────────────────────────────────

  function onResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = asideWidth;

    function onMove(ev: MouseEvent) {
      if (!isResizingRef.current) return;
      // Dragging left increases aside width; dragging right decreases it
      const delta = startXRef.current - ev.clientX;
      const newWidth = Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, startWidthRef.current + delta));
      setAsideWidth(newWidth);
    }

    function onUp() {
      isResizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Persist to localStorage
      setAsideWidth((w) => {
        localStorage.setItem(ASIDE_WIDTH_LS_KEY, String(w));
        return w;
      });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ─── Drag & drop handlery ──────────────────────────────────────────────────

  function handleDragStart(item: ExpediceItem) {
    setDraggedItem(item);
  }

  function handleDragEnd() {
    setDraggedItem(null);
  }

  async function handleDropOnDay(targetDate: string, beforeItemKey: string | null) {
    if (!draggedItem || !data) return;

    const dragKey = `${draggedItem.sourceType}-${draggedItem.id}`;

    // Zjistit aktuální den položky
    const currentDate =
      draggedItem.sourceType === "block"
        ? draggedItem.deadlineExpedice
        : draggedItem.date;

    const isSameDayReorder = currentDate === targetDate;

    // Výpočet nového sort order (klientský odhad)
    const targetDayItems = data.days.find((d) => d.date === targetDate)?.items ?? [];
    const newSortOrder = computeInsertSortOrder(
      targetDayItems,
      isSameDayReorder ? dragKey : "",
      beforeItemKey
    );

    // Optimistická aktualizace
    const prevData = data;
    setData(applyOptimisticMove(data, draggedItem, targetDate, beforeItemKey, newSortOrder));
    setDraggedItem(null);

    try {
      if (draggedItem.sourceType === "block") {
        if (isSameDayReorder) {
          // Reorder v rámci dne — jen sort order
          const r = await fetch(`/api/blocks/${draggedItem.id}/expedition`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reorder", expeditionSortOrder: newSortOrder }),
          });
          if (!r.ok) throw new Error("API error");
        } else {
          // Přesun na jiný den — server přidělí sort order na konci cílového dne
          const r = await fetch(`/api/blocks/${draggedItem.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deadlineExpedice: targetDate }),
          });
          if (!r.ok) throw new Error("API error");
        }
      } else {
        if (isSameDayReorder) {
          // Reorder v rámci dne
          const r = await fetch(`/api/expedice/manual-items/${draggedItem.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expeditionSortOrder: newSortOrder }),
          });
          if (!r.ok) throw new Error("API error");
        } else {
          // Přesun na jiný den nebo z fronty na den — server přidělí sort order
          const r = await fetch(`/api/expedice/manual-items/${draggedItem.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: targetDate }),
          });
          if (!r.ok) throw new Error("API error");
        }
      }
      // Sync s DB
      await fetchData();
    } catch {
      // Vrátit optimistickou aktualizaci při chybě
      setData(prevData);
    }
  }

  async function handleDropOnQueue() {
    if (!draggedItem || !data) return;
    if (draggedItem.sourceType !== "manual") return; // bloky nelze vrátit do fronty
    if (!draggedItem.date) { setDraggedItem(null); return; } // je už ve frontě

    const prevData = data;
    setData(applyOptimisticMove(data, draggedItem, null, null, 0));
    setDraggedItem(null);

    try {
      const r = await fetch(`/api/expedice/manual-items/${draggedItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: null }),
      });
      if (!r.ok) throw new Error("API error");
      await fetchData();
    } catch {
      setData(prevData);
    }
  }

  // ─── Filtrování dnů ────────────────────────────────────────────────────────
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

  // ─── Styly ─────────────────────────────────────────────────────────────────

  const pillGroup: React.CSSProperties = {
    display: "flex", gap: 2, padding: 2, borderRadius: 999,
    background: "var(--surface-2)", border: "1px solid var(--border)",
    boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--text) 8%, transparent)",
  };

  const pillBtn = (active: boolean): React.CSSProperties => ({
    height: 24, padding: "0 10px", fontSize: 11,
    fontWeight: active ? 700 : 600, borderRadius: 999, cursor: "pointer",
    background: active ? "var(--brand)" : "transparent",
    border: active
      ? "1px solid color-mix(in oklab, var(--brand) 75%, var(--text))"
      : "1px solid transparent",
    color: active ? "var(--brand-contrast)" : "var(--text-muted)",
    lineHeight: 1, transition: "all 140ms ease-out",
    boxShadow: active ? "0 2px 8px color-mix(in oklab, var(--text) 20%, transparent)" : "none",
  });

  const outlineBtn: React.CSSProperties = {
    height: 28, padding: "0 12px", borderRadius: 6, fontSize: 11,
    fontWeight: 500, cursor: "pointer",
    background: "var(--surface-2)", border: "1px solid var(--border)",
    color: "var(--text-muted)", transition: "all 120ms ease-out",
  };

  const divider: React.CSSProperties = {
    width: 1, height: 16, background: "rgba(255,255,255,0.12)", flexShrink: 0,
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      background: "var(--bg)", color: "var(--text)",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
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

        {/* Dnes */}
        <button onClick={() => timelineRef.current?.scrollToToday()} style={outlineBtn}>
          Dnes
        </button>

        {/* Přejít na datum */}
        <div style={{ width: 140 }}>
          <DatePickerField
            value={jumpDate}
            onChange={(v) => { setJumpDate(v); if (v) timelineRef.current?.scrollToDate(v); }}
            placeholder="Přejít na datum…"
          />
        </div>

        <div style={divider} />

        {/* Filtry */}
        <div style={pillGroup}>
          {(["all", "block", "manual", "internal"] as Filter[]).map((f) => {
            const labels: Record<Filter, string> = {
              all: "Vše", block: "Tiskový", manual: "Ruční", internal: "Interní",
            };
            return (
              <button key={f} type="button" onClick={() => setFilter(f)} style={pillBtn(filter === f)}>
                {labels[f]}
              </button>
            );
          })}
        </div>

        <div style={divider} />

        {/* Rozsah dnů */}
        <div style={pillGroup}>
          {([7, 14, 30] as DaysRange[]).map((d) => (
            <button key={d} type="button" onClick={() => setDaysAhead(d)} style={pillBtn(daysAhead === d)}>
              {d}d
            </button>
          ))}
        </div>
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
              ref={timelineRef}
              days={filteredDays}
              selectedItemKey={selectedKeyFor(selectedItem)}
              onSelectItem={isEditor ? handleSelectItem : undefined}
              onDoubleClickItem={isEditor ? handleDoubleClickItem : undefined}
              onClickEmpty={handleClickEmpty}
              isEditor={isEditor}
              draggedItem={draggedItem}
              onDragStartItem={handleDragStart}
              onDragEndItem={handleDragEnd}
              onDropOnDay={handleDropOnDay}
            />
            {/* Resize handle */}
            {isEditor && data && (
              <div
                onMouseDown={onResizeMouseDown}
                style={{
                  width: 5, flexShrink: 0, cursor: "col-resize",
                  background: "transparent",
                  transition: "background 80ms ease-out",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.25)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              />
            )}
            {isEditor && data && (
              <ExpediceAside
                width={asideWidth}
                panelMode={panelMode}
                selectedItem={selectedItem}
                candidates={data.candidates}
                queueItems={data.queueItems}
                selectedKey={selectedKeyFor(selectedItem)}
                isDirty={isDirty}
                onPublish={handlePublish}
                onUnpublish={handleUnpublishFromDetail}
                onSwitchToEdit={handleSwitchToEdit}
                onSwitchToDetail={handleSwitchToDetail}
                onSwitchToBuilder={handleSwitchToBuilder}
                onDirtyChange={setIsDirty}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
                onSelectQueueItem={handleSelectQueueItem}
                draggedItem={draggedItem}
                onDragStartItem={handleDragStart}
                onDragEndItem={handleDragEnd}
                onDropOnQueue={handleDropOnQueue}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
