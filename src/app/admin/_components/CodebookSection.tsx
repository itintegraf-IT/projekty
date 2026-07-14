"use client";

import { useEffect, useRef, useState } from "react";
import { inputStyle, btnPrimary, btnSecondary, btnDanger, btnAddAccent } from "@/lib/uiStyles";
import { BADGE_COLOR_KEYS, BADGE_COLOR_LABELS, type BadgeColorKey } from "@/lib/badgeColors";
import { PrinterCodebook } from "@/components/admin/PrinterCodebook";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SECTION_BG, SEPARATOR, TEXT_PRIMARY, TEXT_SECONDARY, BORDER_SUBTLE } from "./adminShared";

// ─── Typy ────────────────────────────────────────────────────────────────────

interface CodebookItem {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isWarning: boolean;
  shortCode: string | null;
  badgeColor: string | null;
}

// ─── Konstanty ───────────────────────────────────────────────────────────────

const CATEGORIES = ["DATA", "MATERIAL", "BARVY", "LAK", "TISKOVY_ARCH", "SERIE"] as const;
type Category = typeof CATEGORIES[number];
const CATEGORY_LABELS: Record<Category, string> = {
  DATA: "DATA",
  MATERIAL: "MATERIÁL",
  BARVY: "BARVY",
  LAK: "LAK",
  TISKOVY_ARCH: "TISKOVÝ ARCH",
  SERIE: "SÉRIE",
};
const PILL_KEYS = [...CATEGORIES, "TISKARI"] as const;
type PillKey = typeof PILL_KEYS[number];
const PILL_LABELS: Record<PillKey, string> = {
  ...CATEGORY_LABELS,
  TISKARI: "TISKAŘI",
};

// ─── Tab: Číselníky ──────────────────────────────────────────────────────────

export function CodebookSection() {
  const [pill, setPill] = useState<PillKey>("DATA");
  const category = pill === "TISKARI" ? null : (pill as Category);
  const [items, setItems] = useState<CodebookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addIsWarning, setAddIsWarning] = useState(false);
  const [addBadgeColor, setAddBadgeColor] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  async function loadItems(cat: Category) {
    setLoading(true);
    const res = await fetch(`/api/codebook?category=${cat}&includeInactive=true`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    setShowAddForm(false);
    setAddLabel("");
    setAddBadgeColor(null);
    if (category) loadItems(category);
  }, [category]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!addLabel.trim() || !category) return;
    setAddLoading(true);
    const res = await fetch("/api/codebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, label: addLabel.trim(), isWarning: addIsWarning, badgeColor: addBadgeColor }),
    });
    if (res.ok) {
      setAddLabel(""); setAddIsWarning(false); setAddBadgeColor(null); setShowAddForm(false);
      await loadItems(category);
    }
    setAddLoading(false);
  }

  async function handleMoveUp(index: number) {
    if (index === 0 || !category) return;
    const a = items[index - 1];
    const b = items[index];
    await Promise.all([
      fetch(`/api/codebook/${a.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`/api/codebook/${b.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ]);
    await loadItems(category);
  }

  async function handleMoveDown(index: number) {
    if (index === items.length - 1 || !category) return;
    const a = items[index];
    const b = items[index + 1];
    await Promise.all([
      fetch(`/api/codebook/${a.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: b.sortOrder }),
      }),
      fetch(`/api/codebook/${b.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: a.sortOrder }),
      }),
    ]);
    await loadItems(category);
  }

  return (
    <div>
      {/* Category tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {PILL_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setPill(key)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: `1px solid ${pill === key ? "#3b82f6" : BORDER_SUBTLE}`,
              background: pill === key ? "rgba(59,130,246,0.12)" : "var(--surface-2, var(--surface))",
              color: pill === key ? "#3b82f6" : TEXT_PRIMARY,
              fontSize: 13,
              fontWeight: pill === key ? 600 : 500,
              cursor: "pointer",
              fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
              transition: "all 0.1s ease-out",
              outline: "none",
              opacity: pill === key ? 1 : 0.75,
            }}
          >
            {PILL_LABELS[key]}
          </button>
        ))}
      </div>

      {!category ? (
        <PrinterCodebook />
      ) : (
      <>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {CATEGORY_LABELS[category]}
        </span>
        <button
          onClick={() => { setShowAddForm(!showAddForm); setAddLabel(""); setAddIsWarning(false); setAddBadgeColor(null); }}
          style={btnAddAccent}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="7" y1="4" x2="7" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Přidat
        </button>
      </div>

      <div style={{ background: SECTION_BG, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER_SUBTLE}` }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Žádné položky</div>
        ) : (
          items.map((item, i) => (
            <CodebookRow
              key={item.id}
              item={item}
              isFirst={i === 0}
              isLast={i === items.length - 1 && !showAddForm}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
              onUpdate={() => loadItems(category)}
            />
          ))
        )}

        {/* Přidat položku — inline form */}
        {showAddForm && (
          <div style={{
            borderTop: items.length > 0 ? `1px solid ${SEPARATOR}` : "none",
            padding: 16,
          }}>
            <form onSubmit={handleAddItem} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  placeholder="Název položky"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  autoFocus
                />
                <WarningToggle value={addIsWarning} onChange={setAddIsWarning} />
              </div>
              <ColorPicker value={addBadgeColor} onChange={setAddBadgeColor} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" style={btnSecondary} onClick={() => { setShowAddForm(false); setAddBadgeColor(null); }}>Zrušit</button>
                <button type="submit" style={btnPrimary} disabled={addLoading || !addLabel.trim()}>
                  {addLoading ? "Přidávám..." : "Přidat"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

function CodebookRow({ item, isFirst, isLast, onMoveUp, onMoveDown, onUpdate }: {
  item: CodebookItem;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(item.label);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  async function handleLabelSave() {
    if (!editLabel.trim() || editLabel.trim() === item.label) {
      setEditLabel(item.label);
      setEditing(false);
      return;
    }
    await fetch(`/api/codebook/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: editLabel.trim() }),
    });
    setEditing(false);
    onUpdate();
  }

  async function handleToggle(field: "isWarning" | "isActive") {
    await fetch(`/api/codebook/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: !item[field] }),
    });
    onUpdate();
  }

  async function handleDelete() {
    await fetch(`/api/codebook/${item.id}`, { method: "DELETE" });
    onUpdate();
  }

  async function handleColorChange(color: string | null) {
    const res = await fetch(`/api/codebook/${item.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badgeColor: color }),
    });
    if (!res.ok) {
      console.error("Badge color update failed", await res.text());
      return;
    }
    onUpdate();
  }

  const isInactive = !item.isActive;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: isLast ? "none" : `1px solid ${SEPARATOR}`,
        background: isInactive ? "color-mix(in oklab, var(--surface-2) 65%, transparent)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px 0 8px",
        height: 52,
      }}>
        {/* Up/down buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            style={{
              background: "transparent", border: "none",
              color: isFirst ? "color-mix(in oklab, var(--text-muted) 35%, transparent)" : TEXT_SECONDARY,
              cursor: isFirst ? "default" : "pointer",
              padding: "1px 4px", lineHeight: 1, fontSize: 10,
              transition: "color 0.1s",
            }}
            title="Posunout nahoru"
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            style={{
              background: "transparent", border: "none",
              color: isLast ? "color-mix(in oklab, var(--text-muted) 35%, transparent)" : TEXT_SECONDARY,
              cursor: isLast ? "default" : "pointer",
              padding: "1px 4px", lineHeight: 1, fontSize: 10,
              transition: "color 0.1s",
            }}
            title="Posunout dolů"
          >▼</button>
        </div>

        {/* Label — kliknutí zahájí editaci */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              ref={inputRef}
              style={{ ...inputStyle, padding: "4px 8px", fontSize: 13 }}
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              onBlur={handleLabelSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLabelSave();
                if (e.key === "Escape") { setEditLabel(item.label); setEditing(false); }
              }}
            />
          ) : (
            <span
              onClick={() => { setEditing(true); setEditLabel(item.label); }}
              style={{
                fontSize: 13,
                color: isInactive ? TEXT_SECONDARY : (item.isWarning ? "var(--warning)" : TEXT_PRIMARY),
                cursor: "text",
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textDecoration: isInactive ? "line-through" : "none",
                opacity: isInactive ? 0.6 : 1,
              }}
              title="Klikněte pro editaci"
            >
              {item.label}
            </span>
          )}
        </div>

        {/* isWarning toggle */}
        <WarningToggle value={item.isWarning} onChange={() => handleToggle("isWarning")} compact />

        {/* Badge color picker */}
        <ColorPicker value={item.badgeColor} onChange={handleColorChange} compact />

        {/* isActive toggle */}
        <button
          onClick={() => handleToggle("isActive")}
          title={item.isActive ? "Aktivní (klikněte pro deaktivaci)" : "Neaktivní (klikněte pro aktivaci)"}
          style={{
            width: 32, height: 18, borderRadius: 9,
            background: item.isActive ? "var(--success)" : "var(--surface-3)",
            border: "none", cursor: "pointer",
            position: "relative", flexShrink: 0,
            transition: "background 0.15s ease-out",
          }}
        >
          <span style={{
            position: "absolute",
            width: 14, height: 14,
            borderRadius: "50%",
            background: "var(--text)",
            top: 2,
            left: item.isActive ? 16 : 2,
            transition: "left 0.15s ease-out",
          }} />
        </button>

        {/* Delete — hover reveal */}
        <button
          onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
          style={{
            background: "transparent", border: "none",
            padding: "4px", cursor: "pointer",
            opacity: hovered ? 1 : 0,
            transition: "opacity 0.15s ease-out",
            color: "var(--danger)",
            display: "flex", alignItems: "center",
          }}
          title="Smazat položku"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M4 3.5l.5 7.5h5L10 3.5" stroke="var(--danger)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Confirm smazání */}
      {showDeleteConfirm && (
        <div style={{ padding: "0 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: TEXT_SECONDARY, flex: 1 }}>
            Smazat <strong style={{ color: TEXT_PRIMARY }}>{item.label}</strong>?
            {" "}<span style={{ fontSize: 11 }}>(existující zakázky zachovají svůj stav)</span>
          </span>
          <button style={btnSecondary} onClick={() => setShowDeleteConfirm(false)}>Zrušit</button>
          <button style={btnDanger} onClick={handleDelete}>Smazat</button>
        </div>
      )}
    </div>
  );
}

// ─── Color picker ─────────────────────────────────────────────────────────────

function ColorPicker({ value, onChange, compact }: {
  value: string | null;
  onChange: (v: string | null) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dotColor = value ? `var(--badge-${value})` : "var(--text-muted)";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value ? `Barva: ${BADGE_COLOR_LABELS[value as BadgeColorKey] ?? value}` : "Bez barvy"}
          style={{
            display: "flex", alignItems: "center", gap: compact ? 0 : 5,
            background: "var(--surface-2)",
            border: `1px solid ${BORDER_SUBTLE}`,
            borderRadius: 6,
            padding: compact ? "5px 7px" : "5px 10px",
            cursor: "pointer",
            flexShrink: 0,
            minHeight: 32,
          }}
        >
          <span style={{
            width: 12, height: 12, borderRadius: "50%",
            background: dotColor,
            display: "inline-block",
            flexShrink: 0,
            border: value ? "none" : "1px dashed var(--text-muted)",
          }} />
          {!compact && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {value ? (BADGE_COLOR_LABELS[value as BadgeColorKey] ?? value) : "Barva"}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 border-0"
        style={{
          background: "var(--surface)",
          border: `1px solid ${BORDER_SUBTLE}`,
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
          width: "max-content",
          maxWidth: 240,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 32px)", justifyContent: "center", gap: 8, marginBottom: 10 }}>
          {BADGE_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={BADGE_COLOR_LABELS[key]}
              aria-pressed={value === key}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: `var(--badge-${key})`,
                border: "2px solid color-mix(in oklab, var(--surface) 88%, transparent)",
                boxShadow: value === key
                  ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)"
                  : "none",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          style={{
            width: "100%", padding: "6px 8px", borderRadius: 6,
            background: value === null ? "color-mix(in oklab, var(--accent) 15%, transparent)" : "transparent",
            border: `1px solid ${value === null ? "var(--accent)" : BORDER_SUBTLE}`,
            color: "var(--text-muted)", fontSize: 11,
            cursor: "pointer", textAlign: "center",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          }}
        >
          × Bez barvy (výchozí)
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Warning toggle ───────────────────────────────────────────────────────────

function WarningToggle({ value, onChange, compact }: {
  value: boolean;
  onChange: (v: boolean) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title={value ? "Upozornění zapnuto" : "Upozornění vypnuto"}
      style={{
        display: "flex", alignItems: "center", gap: compact ? 0 : 5,
        background: value ? "color-mix(in oklab, var(--warning) 15%, transparent)" : "var(--surface-2)",
        border: `1px solid ${value ? "color-mix(in oklab, var(--warning) 40%, transparent)" : BORDER_SUBTLE}`,
        borderRadius: 6,
        padding: compact ? "4px 6px" : "5px 10px",
        color: value ? "var(--warning)" : TEXT_SECONDARY,
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        transition: "all 0.15s ease-out",
        flexShrink: 0,
      }}
    >
      ⚠{!compact && <span style={{ fontSize: 11 }}>{value ? "Warn" : "off"}</span>}
    </button>
  );
}
