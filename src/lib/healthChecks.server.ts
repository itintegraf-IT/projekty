import { detectCalendarDrift, type DriftedBlock } from "@/lib/calendarDrift.server";
import { SLOT_MS } from "@/lib/printTime";
import { MACHINES, machineLabel } from "@/lib/machines";
import { formatPragueTime } from "@/lib/dateUtils";
import { SPLIT_SHARED_FIELDS } from "@/lib/splitSharedFields";
import { FIELD_LABELS, fmtAuditVal } from "@/lib/auditFormatters";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import { readdir } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const DRIFT_HORIZON_DAYS = 365;
const MAX_ITEMS = 50; // strop položek per kontrola v payloadu
const VALID_TYPES = ["ZAKAZKA", "REZERVACE", "UDRZBA"];
const MAX_PRINT_MINUTES = 2400; // 40 h (viz scheduleValidationServer)
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "reservation-attachments");

// ── Typy ──────────────────────────────────────────────────────────────────
export type BlockRow = {
  id: number;
  orderNumber: string;
  machine: string;
  type: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
  printCompletedAt: Date | null;
  printCompletedByUserId: number | null;
  jobPresetId: number | null;
};

export type BlockRef = { id: number; orderNumber: string; type: string; startTime: Date; endTime: Date };

export type OverlapPair = {
  machine: string;
  a: BlockRef;
  b: BlockRef;
  overlapStart: Date;
  overlapEnd: Date;
  overlapMinutes: number;
};

export type DriftItem = {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: Date;
  storedEnd: Date;
  expectedEnd: Date | null;
  reason: DriftedBlock["reason"];
};

export type IntegrityItem = {
  id: number;
  orderNumber: string;
  /** Hotový zobrazovací text stroje — UI nic nedopočítává. */
  machine: string;
  type: string;
  startTime: Date;
  /** Konkrétní vadná hodnota, česky. Bez ní je nález nedohledatelný. */
  detail: string;
};
export type IntegrityIssue = { key: string; label: string; count: number | null; items: IntegrityItem[]; error?: string };
export type AttachmentFileRow = { id: number; reservationId: number; originalName: string; storageKey: string };
export type DiskEntry = { reservationId: number; storageKey: string };
export type AttachmentIssues = { missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };

export type HealthResult = {
  checkedAt: string;
  checks: {
    overlaps: { count: number | null; items: OverlapPair[]; error?: string };
    drift: { count: number | null; items: DriftItem[]; error?: string };
    outsideHours: { count: number | null; items: DriftItem[]; error?: string };
    integrity: { count: number | null; breakdown: IntegrityIssue[]; error?: string };
    attachments: { count: number | null; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[]; error?: string };
  };
};

// ── Překryvy ──────────────────────────────────────────────────────────────
function toRef(b: BlockRow): BlockRef {
  return { id: b.id, orderNumber: b.orderNumber, type: b.type, startTime: b.startTime, endTime: b.endTime };
}

/**
 * Všechny BUDOUCÍ překrývající se páry bloků na stejném stroji (typově agnostické).
 * „Budoucí" = konec překryvu min(aEnd,bEnd) je po `now`. Čistá funkce.
 */
export function computeOverlapPairs(blocks: BlockRow[], now: Date): OverlapPair[] {
  const byMachine = new Map<string, BlockRow[]>();
  for (const b of blocks) {
    const arr = byMachine.get(b.machine) ?? [];
    arr.push(b);
    byMachine.set(b.machine, arr);
  }
  const nowMs = now.getTime();
  const pairs: OverlapPair[] = [];
  for (const arr of byMachine.values()) {
    const sorted = [...arr].sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]!;
        if (b.startTime.getTime() >= a.endTime.getTime()) break; // seřazeno dle startu → dál už nic a nepřekryje
        const overlapStart = new Date(Math.max(a.startTime.getTime(), b.startTime.getTime()));
        const overlapEnd = new Date(Math.min(a.endTime.getTime(), b.endTime.getTime()));
        if (overlapEnd.getTime() <= nowMs) continue; // jen budoucí
        pairs.push({
          machine: a.machine,
          a: toRef(a),
          b: toRef(b),
          overlapStart,
          overlapEnd,
          overlapMinutes: Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000),
        });
      }
    }
  }
  return pairs.sort((p, q) => p.overlapStart.getTime() - q.overlapStart.getTime());
}

// ── Integrita dat ───────────────────────────────────────────────────────────
export type IntegrityRefs = {
  jobPresetIds: Set<number>;
};

function toItem(b: BlockRow, detail: string): IntegrityItem {
  return {
    id: b.id, orderNumber: b.orderNumber, machine: machineLabel(b.machine),
    type: b.type, startTime: b.startTime, detail,
  };
}

/**
 * Neplatné hodnoty a osiřelý preset. Čistá funkce nad načtenými bloky.
 *
 * Osiřelou split-skupinu / rezervaci / rodiče opakování zde ZÁMĚRNĚ nehlídáme —
 * všechny tři sloupce mají cizí klíč (`Block_splitGroupId_fkey`,
 * `Block_reservationId_fkey`, `Block_recurrenceParentId_fkey`), takže takový stav
 * MySQL nedovolí vzniknout. Co garantuje databáze, nemá smysl kontrolovat aplikací.
 * `jobPresetId` cizí klíč NEMÁ, proto zůstává.
 *
 * Podměrečná split-skupina se nehlásí taky záměrně: vzniká legitimní akcí plánovače
 * (rozdělení zakázky a smazání jedné půlky), nic nerozbíjí — všichni konzumenti
 * `splitGroupId` se ptají na počet sourozenců, ne na existenci skupiny — a z aplikace
 * se s ní nedá nic udělat. Ověřeno nad ostrou DB 13. 8. 2026, viz spec.
 * Skutečné riziko split-skupin hlídá `computeSplitDivergence`.
 */
export function computeIntegrityIssues(blocks: BlockRow[], refs: IntegrityRefs): IntegrityIssue[] {
  const machines = MACHINES as readonly string[];
  const issues: IntegrityIssue[] = [];
  const add = (key: string, label: string, hits: BlockRow[], detail: (b: BlockRow) => string) => {
    issues.push({
      key, label, count: hits.length,
      items: hits.slice(0, MAX_ITEMS).map((b) => toItem(b, detail(b))),
    });
  };

  add("orphanJobPreset", "Osiřelý jobPreset (blok odkazuje na smazaný preset)",
    blocks.filter((b) => b.jobPresetId != null && !refs.jobPresetIds.has(b.jobPresetId)),
    (b) => `preset #${b.jobPresetId} neexistuje`);
  add("invalidMachine", "Neplatný stroj",
    blocks.filter((b) => !machines.includes(b.machine)),
    (b) => `stroj „${b.machine}"`);
  add("invalidType", "Neplatný typ bloku",
    blocks.filter((b) => !VALID_TYPES.includes(b.type)),
    (b) => `typ „${b.type}"`);
  add("negativeInterval", "Konec ≤ začátek (nelogický interval)",
    blocks.filter((b) => b.endTime.getTime() <= b.startTime.getTime()),
    (b) => `konec ${formatPragueTime(b.endTime)} ≤ začátek ${formatPragueTime(b.startTime)}`);
  add("badPrintMinutes", "Vadné printMinutes (ZAKÁZKA)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.printMinutes != null &&
      (b.printMinutes <= 0 || b.printMinutes > MAX_PRINT_MINUTES || b.printMinutes % 30 !== 0)),
    (b) => `${b.printMinutes} min`);
  add("unalignedStart", "Nezarovnaný start (mimo 30min mřížku)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.startTime.getTime() % SLOT_MS !== 0),
    (b) => `start ${formatPragueTime(b.startTime)}`);
  add("inconsistentPrintCompleted", "Nekonzistentní dokončení tisku (jen jeden ze dvou údajů)",
    blocks.filter((b) => (b.printCompletedAt == null) !== (b.printCompletedByUserId == null)),
    (b) => (b.printCompletedAt != null ? "čas dokončení bez uživatele" : "uživatel bez času dokončení"));

  return issues;
}

// ── Rozešlá split-skupina ────────────────────────────────────────────────────
export type SplitSharedRow = Record<string, unknown> & {
  id: number;
  machine: string;
  orderNumber: string;
  type: string;
  startTime: Date;
  splitGroupId: number;
};

/** Sentinel pro chybějící hodnotu — odlišuje NULL od prázdného řetězce. */
const NULL_SENTINEL = "\u0000null";

/** Kanonický tvar hodnoty pro porovnání napříč členy skupiny. */
function normalizeShared(v: unknown): string {
  if (v === null || v === undefined) return NULL_SENTINEL;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Tvar, kterému rozumí `fmtAuditVal` (bere `string | null`). */
function toAuditString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Členové jedné split-skupiny mají sdílet všech 31 polí ze `SPLIT_SHARED_FIELDS`.
 * Když se některé rozejde, dvě části téže zakázky se navenek tváří jako různá práce
 * (jedna půlka „materiál skladem", druhá ne). CLAUDE.md tuhle třídu vad vede jako
 * Critical nález go/no-go auditu 5. 8. 2026 — dosud ji nehlídalo nic.
 *
 * Seznam polí se ZÁMĚRNĚ bere ze `SPLIT_SHARED_FIELDS`, ne z ručně psané kopie:
 * nové sdílené pole se tak začne hlídat samo. Hlídá to i strážný test.
 *
 * Jednotka nálezu je SKUPINA, ne blok — opravuje se skupina jako celek.
 * Čistá funkce.
 */
export function computeSplitDivergence(rows: SplitSharedRow[]): IntegrityIssue {
  const byGroup = new Map<number, SplitSharedRow[]>();
  for (const r of rows) {
    const arr = byGroup.get(r.splitGroupId) ?? [];
    arr.push(r);
    byGroup.set(r.splitGroupId, arr);
  }

  const items: IntegrityItem[] = [];
  let count = 0;
  const groupIds = [...byGroup.keys()].sort((a, b) => a - b);

  for (const gid of groupIds) {
    const members = byGroup.get(gid)!;
    if (members.length < 2) continue; // není co porovnávat

    const divergedFields = SPLIT_SHARED_FIELDS.filter((field) => {
      const distinct = new Set(members.map((m) => normalizeShared(m[field])));
      return distinct.size > 1;
    });
    if (divergedFields.length === 0) continue;

    count++;
    if (items.length >= MAX_ITEMS) continue;

    const sorted = [...members].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const detail = divergedFields
      .map((field) => {
        const label = FIELD_LABELS[field] ?? field;
        const values = sorted
          .map((m) => `${m.id} = ${fmtAuditVal(toAuditString(m[field]), field)}`)
          .join(", ");
        return `${label}: ${values}`;
      })
      .join(" · ");

    const machines = [...new Set(sorted.map((m) => machineLabel(m.machine)))].join(" + ");
    const head = sorted[0]!;
    items.push({
      id: head.id,
      orderNumber: head.orderNumber,
      machine: machines,
      type: head.type,
      startTime: head.startTime,
      detail,
    });
  }

  return { key: "splitFieldsDiverged", label: "Rozešlá split-skupina (části mají různé údaje)", count, items };
}

// ── Přílohy: disk vs. DB ─────────────────────────────────────────────────────
/** Množinový rozdíl DB metadat a souborů na disku (klíč = "reservationId/storageKey"). Čistá funkce. */
export function diffAttachmentFiles(dbRows: AttachmentFileRow[], diskEntries: DiskEntry[]): AttachmentIssues {
  const key = (o: { reservationId: number; storageKey: string }) => `${o.reservationId}/${o.storageKey}`;
  const diskSet = new Set(diskEntries.map(key));
  const dbSet = new Set(dbRows.map(key));
  return {
    missingFiles: dbRows.filter((r) => !diskSet.has(key(r))).slice(0, MAX_ITEMS),
    orphanFiles: diskEntries.filter((e) => !dbSet.has(key(e))).slice(0, MAX_ITEMS),
  };
}

/** Naskenuje `data/reservation-attachments/<reservationId>/<storageKey>`. Chybějící složka = prázdno. */
export async function scanAttachmentDir(dir: string): Promise<DiskEntry[]> {
  let subdirs: string[];
  try {
    subdirs = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return []; // složka neexistuje (žádné přílohy)
  }
  const entries: DiskEntry[] = [];
  for (const sub of subdirs) {
    const reservationId = Number(sub);
    if (!Number.isInteger(reservationId)) continue;
    try {
      const files = (await readdir(path.join(dir, sub), { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name);
      for (const storageKey of files) entries.push({ reservationId, storageKey });
    } catch {
      continue;
    }
  }
  return entries;
}

// ── Drift bucket + agregátor ─────────────────────────────────────────────────
/** END_MISMATCH/HORIZON_EXCEEDED → drift; START_NOT_RUNNABLE → mimo provoz. Čistá funkce. */
export function bucketDrift(drifted: DriftedBlock[]): { drift: DriftItem[]; outsideHours: DriftItem[] } {
  const drift: DriftItem[] = [];
  const outsideHours: DriftItem[] = [];
  for (const d of drifted) {
    const item: DriftItem = {
      id: d.id, orderNumber: d.orderNumber, machine: d.machine,
      startTime: d.startTime, storedEnd: d.endTime, expectedEnd: d.expectedEnd, reason: d.reason,
    };
    if (d.reason === "START_NOT_RUNNABLE") outsideHours.push(item);
    else drift.push(item);
  }
  return { drift, outsideHours };
}

const BLOCK_SELECT = {
  id: true, orderNumber: true, machine: true, type: true, startTime: true, endTime: true,
  printMinutes: true, printCompletedAt: true, printCompletedByUserId: true, jobPresetId: true,
} as const;

/**
 * Select pro kontrolu rozešlé skupiny. Skládá se ZE `SPLIT_SHARED_FIELDS`, ne z ručně
 * psaného seznamu — nové sdílené pole se tak začne číst samo. Kdyby produkční schéma
 * některý sloupec nemělo, Prisma spadne hlasitě (P2022), ne tiše.
 */
const SPLIT_SELECT = Object.fromEntries(
  [...SPLIT_SHARED_FIELDS, "id", "machine", "startTime", "splitGroupId"].map((f) => [f, true]),
) as Prisma.BlockSelect;

/**
 * Spustí jednu kontrolu izolovaně. Při výjimce vrátí `null` a text chyby, takže
 * ostatní kontroly doběhnou a zobrazí se. Bez tohohle by jedna rozbitá kontrola
 * (typicky sloupec, který produkce ještě nemá) shodila celý panel na 500 —
 * u nástroje, který má odhalovat tiché vady, je to nejhorší možné chování.
 */
export async function attempt<T>(label: string, fn: () => Promise<T>): Promise<{ value: T | null; error?: string }> {
  try {
    return { value: await fn() };
  } catch (err) {
    logger.error(`[health] kontrola ${label} selhala`, err);
    return { value: null, error: err instanceof Error ? err.message : "neznámá chyba" };
  }
}

/**
 * Spočítá všech 5 kontrol. Čte celou tabulku Block (pár sloupců) 1× a sdílí ji mezi
 * překryvy a integritu; drift/mimo provoz z detectCalendarDrift; přílohy FS sken.
 * Jen čte. Typováno na `typeof prisma` (thin wiring) — logika je v pure funkcích výše.
 */
export async function runHealthChecks(db: typeof prisma, now: Date): Promise<HealthResult> {
  const [allBlocks, jobPresets, attachmentRows] = await Promise.all([
    db.block.findMany({ select: BLOCK_SELECT }),
    db.jobPreset.findMany({ select: { id: true } }),
    db.reservationAttachment.findMany({ select: { id: true, reservationId: true, originalName: true, storageKey: true } }),
  ]);

  const blocks = allBlocks as BlockRow[];
  const refs: IntegrityRefs = { jobPresetIds: new Set(jobPresets.map((p) => p.id)) };

  const driftR = await attempt("drift", async () => bucketDrift(await detectCalendarDrift(
    db, [...MACHINES], now, new Date(now.getTime() + DRIFT_HORIZON_DAYS * DAY_MS), now,
  )));
  const overlapsR = await attempt("overlaps", async () => computeOverlapPairs(blocks, now));
  const baseR = await attempt("integrity", async () => computeIntegrityIssues(blocks, refs));
  const divergedR = await attempt("splitFieldsDiverged", async () => computeSplitDivergence(
    (await db.block.findMany({ where: { splitGroupId: { not: null } }, select: SPLIT_SELECT })) as unknown as SplitSharedRow[],
  ));
  const attachR = await attempt("attachments", async () =>
    diffAttachmentFiles(attachmentRows, await scanAttachmentDir(ATTACHMENTS_DIR)));

  // Rozpad integrity: základní kontroly + řádek rozešlé skupiny. Když selže jen
  // ten druhý, zbytek rozpadu se pořád ukáže — jen s vlastní značkou „nespočteno".
  const breakdown: IntegrityIssue[] = [
    ...(baseR.value ?? []),
    divergedR.value ?? {
      key: "splitFieldsDiverged", label: "Rozešlá split-skupina (části mají různé údaje)",
      count: null, items: [], error: divergedR.error,
    },
  ];
  // Karta nese `error`, i když se sama spočetla — jinak by dílčí selhání zmizelo.
  const integrityError = baseR.error ?? (divergedR.error != null ? "Dílčí kontrola nespočtena." : undefined);
  const integrityCount = baseR.value == null
    ? null
    : breakdown.reduce((s, i) => s + (i.count ?? 0), 0);

  return {
    checkedAt: now.toISOString(),
    checks: {
      overlaps: { count: overlapsR.value?.length ?? null, items: (overlapsR.value ?? []).slice(0, MAX_ITEMS), error: overlapsR.error },
      drift: { count: driftR.value?.drift.length ?? null, items: (driftR.value?.drift ?? []).slice(0, MAX_ITEMS), error: driftR.error },
      outsideHours: { count: driftR.value?.outsideHours.length ?? null, items: (driftR.value?.outsideHours ?? []).slice(0, MAX_ITEMS), error: driftR.error },
      integrity: { count: integrityCount, breakdown, error: integrityError },
      attachments: {
        count: attachR.value == null ? null : attachR.value.missingFiles.length + attachR.value.orphanFiles.length,
        missingFiles: attachR.value?.missingFiles ?? [],
        orphanFiles: attachR.value?.orphanFiles ?? [],
        error: attachR.error,
      },
    },
  };
}
