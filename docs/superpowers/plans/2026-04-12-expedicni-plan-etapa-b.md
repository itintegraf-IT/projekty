# Expediční plán — Etapa B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postavit read-only expediční stránku `/expedice` s timeline publishnutých bloků po dnech, sekcí kandidátů pro editory s inline publish akcí a zkratek v PlannerPage (header button, context menu, detail bloku).

**Architecture:** Nová stránka `/expedice` sdílí vizuální jazyk s hlavní timeline. `GET /api/expedice` vrátí sloučená data: timeline (publishnuté bloky + naplánované ruční položky po dnech), kandidáti (nepublikované ZAKAZKA bloky s termínem), fronta (ruční položky bez data). Pravý aside (jen ADMIN/PLANOVAT) zobrazuje kandidáty s inline publish akcí. Etapa B záměrně nevytváří builder ani editor — to je Etapa C.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Prisma 5, MySQL — bez nových závislostí.

---

## Soubory

| Operace | Soubor | Odpovědnost |
|---------|--------|-------------|
| Create | `src/lib/expediceTypes.ts` | Sdílené typy pro API response + UI |
| Create | `src/app/api/expedice/route.ts` | GET: days + candidates + queueItems |
| Create | `src/app/expedice/page.tsx` | Server Component, auth check |
| Create | `src/app/expedice/_components/ExpedicePage.tsx` | Client Component, hlavní stav |
| Create | `src/app/expedice/_components/ExpediceTimeline.tsx` | Timeline po dnech |
| Create | `src/app/expedice/_components/ExpediceCard.tsx` | Kompaktní karta položky |
| Create | `src/app/expedice/_components/ExpediceAside.tsx` | Pravý panel — kandidáti + publish |
| Modify | `src/lib/blockSerialization.ts` | Správná serializace `expeditionPublishedAt` |
| Modify | `src/app/_components/TimelineGrid.tsx` | Block type + nová pole + context menu akce |
| Modify | `src/app/_components/PlannerPage.tsx` | Header "Expedice" tlačítko + publish shortcut v detailu bloku |

---

## Task 1: Typy + `GET /api/expedice`

**Files:**
- Create: `src/lib/expediceTypes.ts`
- Create: `src/app/api/expedice/route.ts`

- [ ] **Krok 1.1: Vytvořit sdílené typy**

Soubor `src/lib/expediceTypes.ts`:

```typescript
export type ExpediceItemKind = "PLANNED_JOB" | "MANUAL_JOB" | "INTERNAL_TRANSFER";

export type ExpediceBlockItem = {
  sourceType: "block";
  itemKind: "PLANNED_JOB";
  id: number;
  orderNumber: string;
  description: string | null;
  expediceNote: string | null;
  doprava: string | null;
  deadlineExpedice: string;        // "YYYY-MM-DD"
  expeditionSortOrder: number | null;
  machine: string;
};

export type ExpediceManualItem = {
  sourceType: "manual";
  itemKind: "MANUAL_JOB" | "INTERNAL_TRANSFER";
  id: number;
  orderNumber: string | null;
  description: string | null;
  expediceNote: string | null;
  doprava: string | null;
  date: string | null;             // "YYYY-MM-DD" nebo null = fronta
  expeditionSortOrder: number | null;
};

export type ExpediceItem = ExpediceBlockItem | ExpediceManualItem;

export type ExpediceDay = {
  date: string;                    // "YYYY-MM-DD"
  items: ExpediceItem[];
};

export type ExpediceCandidate = {
  id: number;
  orderNumber: string;
  description: string | null;
  expediceNote: string | null;
  doprava: string | null;
  deadlineExpedice: string;        // "YYYY-MM-DD"
  machine: string;
};

export type ExpediceData = {
  days: ExpediceDay[];
  candidates: ExpediceCandidate[];
  queueItems: ExpediceManualItem[];
};
```

- [ ] **Krok 1.2: Vytvořit `GET /api/expedice`**

Soubor `src/app/api/expedice/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getExpeditionDayKey } from "@/lib/expedition";
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import type { ExpediceDay, ExpediceItem, ExpediceCandidate, ExpediceManualItem } from "@/lib/expediceTypes";

function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const daysBack  = Math.max(0,  parseInt(url.searchParams.get("daysBack")  ?? "3",  10));
  const daysAhead = Math.max(1,  parseInt(url.searchParams.get("daysAhead") ?? "14", 10));

  const todayKey     = getExpeditionDayKey(new Date())!;
  const rangeStart   = civilDateToUTCMidnight(addDays(todayKey, -daysBack));
  const rangeEnd     = civilDateToUTCMidnight(addDays(todayKey, daysAhead));

  try {
    const [publishedBlocks, scheduledManual, candidateBlocks, queueManual] = await Promise.all([
      prisma.block.findMany({
        where: {
          expeditionPublishedAt: { not: null },
          deadlineExpedice: { gte: rangeStart, lte: rangeEnd },
        },
        select: {
          id: true, orderNumber: true, description: true,
          expediceNote: true, doprava: true,
          deadlineExpedice: true, expeditionSortOrder: true, machine: true,
        },
        orderBy: [{ deadlineExpedice: "asc" }, { expeditionSortOrder: "asc" }],
      }),
      prisma.expeditionManualItem.findMany({
        where: { date: { gte: rangeStart, lte: rangeEnd } },
        orderBy: [{ date: "asc" }, { expeditionSortOrder: "asc" }],
      }),
      prisma.block.findMany({
        where: {
          type: "ZAKAZKA",
          deadlineExpedice: { not: null },
          expeditionPublishedAt: null,
        },
        select: {
          id: true, orderNumber: true, description: true,
          expediceNote: true, doprava: true,
          deadlineExpedice: true, machine: true, updatedAt: true,
        },
        orderBy: [{ deadlineExpedice: "asc" }, { updatedAt: "desc" }],
      }),
      prisma.expeditionManualItem.findMany({
        where: { date: null },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Sestavit timeline po dnech
    const dayMap = new Map<string, ExpediceDay>();

    for (const b of publishedBlocks) {
      const dayKey = getExpeditionDayKey(b.deadlineExpedice)!;
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, { date: dayKey, items: [] });
      dayMap.get(dayKey)!.items.push({
        sourceType: "block", itemKind: "PLANNED_JOB",
        id: b.id, orderNumber: b.orderNumber,
        description: b.description, expediceNote: b.expediceNote, doprava: b.doprava,
        deadlineExpedice: dayKey, expeditionSortOrder: b.expeditionSortOrder, machine: b.machine,
      } satisfies ExpediceItem);
    }

    for (const m of scheduledManual) {
      const dayKey = getExpeditionDayKey(m.date)!;
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, { date: dayKey, items: [] });
      dayMap.get(dayKey)!.items.push({
        sourceType: "manual", itemKind: m.kind,
        id: m.id, orderNumber: m.orderNumber,
        description: m.description, expediceNote: m.expediceNote, doprava: m.doprava,
        date: dayKey, expeditionSortOrder: m.expeditionSortOrder,
      } satisfies ExpediceItem);
    }

    // Seřadit dny ASC, uvnitř dne položky podle expeditionSortOrder ASC
    const days: ExpediceDay[] = Array.from(dayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({
        ...day,
        items: [...day.items].sort(
          (a, b) => (a.expeditionSortOrder ?? Infinity) - (b.expeditionSortOrder ?? Infinity)
        ),
      }));

    const candidates: ExpediceCandidate[] = candidateBlocks.map((b) => ({
      id: b.id, orderNumber: b.orderNumber, description: b.description,
      expediceNote: b.expediceNote, doprava: b.doprava,
      deadlineExpedice: getExpeditionDayKey(b.deadlineExpedice)!,
      machine: b.machine,
    }));

    const queueItems: ExpediceManualItem[] = queueManual.map((m) => ({
      sourceType: "manual", itemKind: m.kind,
      id: m.id, orderNumber: m.orderNumber,
      description: m.description, expediceNote: m.expediceNote, doprava: m.doprava,
      date: null, expeditionSortOrder: null,
    }));

    return NextResponse.json({ days, candidates, queueItems });
  } catch (error) {
    console.error("[GET /api/expedice]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
```

- [ ] **Krok 1.3: Ověřit endpoint**

```bash
# Dev server musí běžet
curl -s http://localhost:3000/api/expedice | head -100
```

Očekávaný výsledek: JSON s klíči `days`, `candidates`, `queueItems`. Bez přihlášení: `{"error":"Unauthorized"}`.

- [ ] **Krok 1.4: Commit**

```bash
git add src/lib/expediceTypes.ts src/app/api/expedice/route.ts
git commit -m "feat: GET /api/expedice — days, candidates, queueItems"
```

---

## Task 2: Block type rozšíření + serializace

**Files:**
- Modify: `src/lib/blockSerialization.ts`
- Modify: `src/app/_components/TimelineGrid.tsx:11-118`

- [ ] **Krok 2.1: Opravit serializaci `expeditionPublishedAt` v `blockSerialization.ts`**

`expeditionPublishedAt` je `Date | null` v DB — musí být serializováno jako ISO string stejně jako `printCompletedAt`. Přidat do `SerializableBlock` i do return hodnoty `serializeBlock`:

V `src/lib/blockSerialization.ts` nahradit:

```typescript
type SerializableBlock = {
  type: string;
  blockVariant?: string | null;
  startTime: Date;
  endTime: Date;
  deadlineExpedice: Date | null;
  dataRequiredDate: Date | null;
  materialRequiredDate: Date | null;
  pantoneRequiredDate: Date | null;
  printCompletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};
```

za:

```typescript
type SerializableBlock = {
  type: string;
  blockVariant?: string | null;
  startTime: Date;
  endTime: Date;
  deadlineExpedice: Date | null;
  dataRequiredDate: Date | null;
  materialRequiredDate: Date | null;
  pantoneRequiredDate: Date | null;
  printCompletedAt: Date | null;
  expeditionPublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};
```

A v `serializeBlock` přidat jeden řádek za `printCompletedAt`:

```typescript
export function serializeBlock<T extends SerializableBlock>(block: T) {
  return {
    ...block,
    blockVariant: normalizeBlockVariant(block.blockVariant as string | null | undefined, block.type),
    startTime: block.startTime.toISOString(),
    endTime: block.endTime.toISOString(),
    deadlineExpedice: normalizeCivilDateInput(block.deadlineExpedice),
    dataRequiredDate: normalizeCivilDateInput(block.dataRequiredDate),
    materialRequiredDate: normalizeCivilDateInput(block.materialRequiredDate),
    pantoneRequiredDate: normalizeCivilDateInput(block.pantoneRequiredDate),
    printCompletedAt: block.printCompletedAt?.toISOString() ?? null,
    expeditionPublishedAt: block.expeditionPublishedAt?.toISOString() ?? null,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}
```

- [ ] **Krok 2.2: Přidat expediční pole do `Block` typu v `TimelineGrid.tsx`**

V `src/app/_components/TimelineGrid.tsx` v `Block` type (řádek ~83, za `deadlineExpedice`):

```typescript
  deadlineExpedice: string | null;
  // Expediční plán
  expediceNote: string | null;
  doprava: string | null;
  expeditionPublishedAt: string | null;
  expeditionSortOrder: number | null;
```

- [ ] **Krok 2.3: Commit**

```bash
git add src/lib/blockSerialization.ts src/app/_components/TimelineGrid.tsx
git commit -m "feat: přidat expediční pole do Block typu a serializace"
```

---

## Task 3: `ExpediceCard` + `ExpediceTimeline`

**Files:**
- Create: `src/app/expedice/_components/ExpediceCard.tsx`
- Create: `src/app/expedice/_components/ExpediceTimeline.tsx`

- [ ] **Krok 3.1: Vytvořit `ExpediceCard.tsx`**

```typescript
"use client";
import React from "react";
import type { ExpediceItem } from "@/lib/expediceTypes";

const BADGE_CONFIG = {
  PLANNED_JOB:       { label: "TISK",    bg: "rgba(59,130,246,0.15)",  color: "#3b82f6" },
  MANUAL_JOB:        { label: "RUČNÍ",   bg: "rgba(34,197,94,0.15)",   color: "#22c55e" },
  INTERNAL_TRANSFER: { label: "INTERNÍ", bg: "rgba(249,115,22,0.15)",  color: "#f97316" },
} as const;

interface ExpediceCardProps {
  item: ExpediceItem;
  selected?: boolean;
  onClick?: () => void;
  density?: "detail" | "standard" | "compact";
}

export function ExpediceCard({ item, selected, onClick, density = "standard" }: ExpediceCardProps) {
  const badge  = BADGE_CONFIG[item.itemKind];
  const vPad   = density === "detail" ? 10 : density === "compact" ? 4 : 7;
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", flexDirection: "column", gap: 3,
        padding: `${vPad}px 10px`,
        borderRadius: 8,
        background: selected
          ? "rgba(59,130,246,0.1)"
          : hovered ? "rgba(255,255,255,0.04)" : "var(--surface-2)",
        border: `1px solid ${selected ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.07)"}`,
        cursor: "pointer",
        minWidth: 0,
        transition: "all 120ms ease-out",
      }}
    >
      {/* Řádek 1: badge + číslo zakázky */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
          padding: "1px 5px", borderRadius: 4, flexShrink: 0,
          background: badge.bg, color: badge.color,
        }}>
          {badge.label}
        </span>
        {item.orderNumber && (
          <span style={{
            fontSize: 11, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {item.orderNumber}
          </span>
        )}
        {"machine" in item && item.machine && (
          <span style={{
            marginLeft: "auto", fontSize: 9, color: "var(--text-muted)",
            flexShrink: 0,
          }}>
            {item.machine.replace("_", " ")}
          </span>
        )}
      </div>

      {/* Řádek 2: popis */}
      {item.description && (
        <div style={{
          fontSize: 11, color: "var(--text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {item.description}
        </div>
      )}

      {/* Řádek 3: expediceNote + doprava (jen v detail a standard hustotě) */}
      {density !== "compact" && (item.expediceNote || item.doprava) && (
        <div style={{
          fontSize: 10, color: "rgba(255,255,255,0.38)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {[item.expediceNote, item.doprava].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Krok 3.2: Vytvořit `ExpediceTimeline.tsx`**

```typescript
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

function todayKey(): string {
  const n = new Date();
  // Použij UTC datum — konzistentní s tím, jak jsou data uložena
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, "0")}-${String(n.getUTCDate()).padStart(2, "0")}`;
}

interface ExpediceTimelineProps {
  days: ExpediceDay[];
  selectedItemKey: string | null;
  onSelectItem: (item: ExpediceItem) => void;
  onClickEmpty: () => void;
  density: "detail" | "standard" | "compact";
}

export function ExpediceTimeline({
  days, selectedItemKey, onSelectItem, onClickEmpty, density,
}: ExpediceTimelineProps) {
  const todayRef = useRef<HTMLDivElement>(null);
  const today    = todayKey();

  // První render → scrollnout na dnešní den
  useEffect(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const gap = density === "compact" ? 3 : 5;

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
```

- [ ] **Krok 3.3: Commit**

```bash
git add src/app/expedice/_components/ExpediceCard.tsx src/app/expedice/_components/ExpediceTimeline.tsx
git commit -m "feat: ExpediceCard + ExpediceTimeline komponenty"
```

---

## Task 4: `ExpediceAside` — kandidáti + publish

**Files:**
- Create: `src/app/expedice/_components/ExpediceAside.tsx`

- [ ] **Krok 4.1: Vytvořit `ExpediceAside.tsx`**

V Etapě B aside zobrazuje jen sekci Kandidátů. Fronta a builder jsou placeholder pro Etapu C.

```typescript
"use client";
import React, { useState } from "react";
import type { ExpediceCandidate } from "@/lib/expediceTypes";

const CS_MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];

function formatDateCs(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface ExpediceAsideProps {
  candidates: ExpediceCandidate[];
  onPublish: (blockId: number) => Promise<void>;
  width?: number;
}

export function ExpediceAside({ candidates, onPublish, width = 320 }: ExpediceAsideProps) {
  return (
    <aside style={{
      width,
      flexShrink: 0,
      borderLeft: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Sekce: Kandidáti */}
      <div style={{
        padding: "14px 16px 10px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          color: "var(--text-muted)", textTransform: "uppercase",
        }}>
          Kandidáti z tiskového plánu
        </div>
        {candidates.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
            {candidates.length} {candidates.length === 1 ? "zakázka čeká" : candidates.length < 5 ? "zakázky čekají" : "zakázek čeká"}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {candidates.length === 0 ? (
          <div style={{
            fontSize: 12, color: "var(--text-muted)",
            padding: "16px 4px", lineHeight: 1.5,
          }}>
            Žádní kandidáti — všechny zakázky s termínem expedice jsou zaplánované.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} onPublish={onPublish} />
            ))}
          </div>
        )}
      </div>

      {/* Sekce: Fronta — placeholder pro Etapu C */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "12px 16px",
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          color: "var(--text-muted)", textTransform: "uppercase",
          marginBottom: 6,
        }}>
          Fronta k naplánování
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>
          Builder a fronta — Etapa C
        </div>
      </div>
    </aside>
  );
}

// ─── CandidateCard ────────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  onPublish,
}: {
  candidate: ExpediceCandidate;
  onPublish: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error,   setError  ] = useState<string | null>(null);

  async function handlePublish() {
    setLoading(true);
    setError(null);
    try {
      await onPublish(candidate.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      padding: "8px 10px", borderRadius: 8,
      background: "var(--surface-2)",
      border: "1px solid rgba(255,255,255,0.07)",
      display: "flex", flexDirection: "column", gap: 5,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {candidate.orderNumber}
          </div>
          {candidate.description && (
            <div style={{
              fontSize: 10, color: "var(--text-muted)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {candidate.description}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "rgba(249,115,22,0.85)", fontWeight: 500 }}>
          {formatDateCs(candidate.deadlineExpedice)}
          <span style={{ marginLeft: 4, color: "var(--text-muted)" }}>
            · {candidate.machine.replace("_", " ")}
          </span>
        </div>
        <button
          onClick={handlePublish}
          disabled={loading}
          style={{
            fontSize: 10, fontWeight: 600, letterSpacing: "0.03em",
            padding: "3px 10px", borderRadius: 6,
            background: loading ? "rgba(59,130,246,0.07)" : "rgba(59,130,246,0.16)",
            border: "1px solid rgba(59,130,246,0.28)",
            color: loading ? "rgba(59,130,246,0.5)" : "#3b82f6",
            cursor: loading ? "default" : "pointer",
            transition: "all 120ms ease-out",
          }}
        >
          {loading ? "..." : "Zaplánovat"}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 10, color: "#ef4444" }}>{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Krok 4.2: Commit**

```bash
git add src/app/expedice/_components/ExpediceAside.tsx
git commit -m "feat: ExpediceAside s kandidáty z tiskového plánu + publish akce"
```

---

## Task 5: `ExpedicePage` + `page.tsx`

**Files:**
- Create: `src/app/expedice/_components/ExpedicePage.tsx`
- Create: `src/app/expedice/page.tsx`

- [ ] **Krok 5.1: Vytvořit `ExpedicePage.tsx`**

```typescript
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
  const filteredDays = (data?.days ?? []).map((day) => ({
    ...day,
    items: day.items.filter((item) => {
      if (filter === "all")      return true;
      if (filter === "block")    return item.sourceType === "block";
      if (filter === "manual")   return item.sourceType === "manual" && item.itemKind === "MANUAL_JOB";
      if (filter === "internal") return item.sourceType === "manual" && item.itemKind === "INTERNAL_TRANSFER";
      return true;
    }),
  })).filter((day) => day.items.length > 0);

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
```

- [ ] **Krok 5.2: Vytvořit `src/app/expedice/page.tsx`**

```typescript
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ExpedicePage } from "./_components/ExpedicePage";

export default async function ExpedicniPlanPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <ExpedicePage role={session.role} />;
}
```

- [ ] **Krok 5.3: Otestovat v prohlížeči**

Otevřít http://localhost:3000/expedice — stránka se načte, zobrazí se timeline (nebo empty state) a pro ADMIN/PLANOVAT pravý panel s kandidáty.

- [ ] **Krok 5.4: Commit**

```bash
git add src/app/expedice/
git commit -m "feat: stránka /expedice — ExpedicePage, timeline, aside s kandidáty"
```

---

## Task 6: PlannerPage — header tlačítko + publish shortcut v detailu bloku

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Krok 6.1: Přidat tlačítko "Expedice" do headeru PlannerPage**

V `PlannerPage.tsx`, za existující `<a href="/rezervace">Rezervace</a>` blok (kolem řádku 4035), přidat (viditelné pro všechny přihlášené role — spec říká `/expedice` je dostupné všem):

```tsx
{/* Expedice — přístupné všem přihlášeným rolím */}
<a
  href="/expedice"
  style={{
    height: 28, padding: "0 10px", borderRadius: 8,
    display: "flex", alignItems: "center",
    background: "var(--surface-2)", border: "1px solid var(--border)",
    color: "#f97316", fontSize: 12, cursor: "pointer",
    textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
  }}
>Expedice</a>
```

- [ ] **Krok 6.2: Přidat publish shortcut do detailu bloku v PlannerPage**

V detailu bloku (kolem řádku 1366, kde se zobrazuje `block.deadlineExpedice`), přidat publish/unpublish akci pro ADMIN/PLANOVAT. Najít sekci kde se zobrazuje expedice info a přidat tlačítko:

```tsx
{/* Expedice shortcut — jen pro ADMIN/PLANOVAT */}
{canEdit && block.type === "ZAKAZKA" && (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Expediční plán</span>
    {!block.deadlineExpedice ? (
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>
        Nejdřív vyplň termín expedice
      </span>
    ) : block.expeditionPublishedAt ? (
      <button
        onClick={async () => {
          try {
            const res = await fetch(`/api/blocks/${block.id}/expedition`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "unpublish" }),
            });
            if (res.ok) {
              const updated = await res.json();
              onBlockUpdate?.(updated);
            }
          } catch { /* noop */ }
        }}
        style={{
          fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
          color: "#ef4444", cursor: "pointer", transition: "all 120ms ease-out",
        }}
      >
        Odebrat z Expedice
      </button>
    ) : (
      <button
        onClick={async () => {
          try {
            const res = await fetch(`/api/blocks/${block.id}/expedition`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "publish" }),
            });
            if (res.ok) {
              const updated = await res.json();
              onBlockUpdate?.(updated);
            }
          } catch { /* noop */ }
        }}
        style={{
          fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 6,
          background: "rgba(59,130,246,0.14)", border: "1px solid rgba(59,130,246,0.28)",
          color: "#3b82f6", cursor: "pointer", transition: "all 120ms ease-out",
        }}
      >
        Zaplánovat do Expedice
      </button>
    )}
  </div>
)}
```

Poznámka: `onBlockUpdate` je existující prop, který aktualizuje blok v paměti po API odpovědi.

- [ ] **Krok 6.3: Ověřit v prohlížeči**

1. Na hlavní stránce kliknout na blok → detail → vidět sekci "Expediční plán"
2. Pro blok bez `deadlineExpedice`: text "Nejdřív vyplň termín expedice"
3. Pro blok s `deadlineExpedice` a bez publish: tlačítko "Zaplánovat do Expedice"
4. Po kliknutí: blok se publishne, tlačítko změní na "Odebrat z Expedice"
5. Otevřít `/expedice` a ověřit, že blok se objevil v timeline

- [ ] **Krok 6.4: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: Expedice tlačítko v headeru + publish shortcut v detailu bloku"
```

---

## Task 7: TimelineGrid — context menu expedice akce

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

- [ ] **Krok 7.1: Přidat props do `TimelineGridProps` a `BlockCardProps`**

V `TimelineGridProps` interface (řádek ~177) přidat:

```typescript
onExpeditionPublish?:   (blockId: number) => Promise<void>;
onExpeditionUnpublish?: (blockId: number) => Promise<void>;
```

V `BlockCardProps` destructure (řádek ~765) přidat stejné dva props.

- [ ] **Krok 7.2: Propojit props z TimelineGrid do BlockCard**

V místě kde se renderuje `<BlockCard ...>` uvnitř `TimelineGrid`, předat nové props:

```tsx
onExpeditionPublish={onExpeditionPublish}
onExpeditionUnpublish={onExpeditionUnpublish}
```

- [ ] **Krok 7.3: Přidat context menu položky do BlockCard**

V `BlockCard` context menu, za existující sekci s `onPrintComplete` (kolem řádku 1625), přidat sekci pro expedici. Vložit před uzavírající `</ContextMenuContent>`:

```tsx
{/* Expedice akce — jen pro ZAKAZKA blok, jen pro editory */}
{canEdit && block.type === "ZAKAZKA" && (
  <>
    <ContextMenuSeparator />
    {!block.deadlineExpedice ? (
      <ContextMenuItem disabled style={{ ...menuItemStyle, color: "rgba(255,255,255,0.3)" }}>
        🚚 Nejdřív vyplň termín expedice
      </ContextMenuItem>
    ) : block.expeditionPublishedAt ? (
      <ContextMenuItem
        onClick={() => onExpeditionUnpublish?.(block.id)}
        style={{ ...menuItemStyle, color: "rgba(239,68,68,0.9)" }}
      >
        🚚 Odebrat z Expedice
      </ContextMenuItem>
    ) : (
      <ContextMenuItem
        onClick={() => onExpeditionPublish?.(block.id)}
        style={menuItemStyle}
      >
        🚚 Zaplánovat do Expedice
      </ContextMenuItem>
    )}
  </>
)}
```

- [ ] **Krok 7.4: Implementovat handlers v `PlannerPage`**

V `PlannerPage.tsx` přidat dvě funkce a předat je do `<TimelineGrid>`:

```typescript
async function handleExpeditionPublish(blockId: number) {
  try {
    const res = await fetch(`/api/blocks/${blockId}/expedition`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" }),
    });
    if (res.ok) {
      const updated = await res.json();
      setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, ...updated } : b));
    }
  } catch { /* noop */ }
}

async function handleExpeditionUnpublish(blockId: number) {
  try {
    const res = await fetch(`/api/blocks/${blockId}/expedition`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unpublish" }),
    });
    if (res.ok) {
      const updated = await res.json();
      setBlocks((prev) => prev.map((b) => b.id === blockId ? { ...b, ...updated } : b));
    }
  } catch { /* noop */ }
}
```

V JSX předat do `<TimelineGrid>`:
```tsx
onExpeditionPublish={canEdit ? handleExpeditionPublish : undefined}
onExpeditionUnpublish={canEdit ? handleExpeditionUnpublish : undefined}
```

- [ ] **Krok 7.5: Ověřit v prohlížeči**

1. Pravý klik na ZAKAZKA blok bez termínu → položka "Nejdřív vyplň termín expedice" (disabled)
2. Pravý klik na ZAKAZKA blok s termínem a bez publish → "Zaplánovat do Expedice"
3. Po kliknutí: block se publishne, context menu se při dalším pravém kliku změní na "Odebrat z Expedice"
4. "Odebrat z Expedice" → blok je odpublishnutý

- [ ] **Krok 7.6: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat: context menu akce Zaplánovat/Odebrat z Expedice v TimelineGrid"
```

---

## Checklist spec coverage (self-review)

| Požadavek spec | Task |
|----------------|------|
| `GET /api/expedice` — days, candidates, queueItems | Task 1 |
| `ExpedicePage`, `ExpediceTimeline`, `ExpediceCard` | Task 3, 5 |
| `src/app/expedice/page.tsx` | Task 5 |
| Tlačítko "Expedice" v headeru | Task 6 |
| Sekce kandidátů v pravém panelu + publish | Task 4 |
| Context menu akce v hlavní timeline | Task 7 |
| Fallback akce v detailu bloku | Task 6 |
| Read-only role vidí jen timeline bez aside | Task 5 (`isEditor` podmínka) |
| Block type rozšíření (`expeditionPublishedAt` atd.) | Task 2 |
| Serializace `expeditionPublishedAt` jako ISO string | Task 2 |
| Middleware `/expedice` pro všechny role | ✅ Hotovo z Etapy A |
| Hustota zobrazení do `localStorage` | Task 5 |
| Scroll na dnešní den při prvním otevření | Task 3 |
| "Dnes" pill u dnešního dne | Task 3 |
| Retry akce při chybě načítání | Task 5 |
| Empty state | Task 3 |
