import { detectCalendarDrift, type DriftedBlock } from "@/lib/calendarDrift.server";
import { SLOT_MS } from "@/lib/printTime";
import { MACHINES } from "@/lib/machines";
import { prisma } from "@/lib/prisma";
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

export type IntegrityIssue = { key: string; label: string; count: number; sampleBlockIds: number[] };
export type AttachmentFileRow = { id: number; reservationId: number; originalName: string; storageKey: string };
export type DiskEntry = { reservationId: number; storageKey: string };
export type AttachmentIssues = { missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };

export type HealthResult = {
  checkedAt: string;
  checks: {
    overlaps: { count: number; items: OverlapPair[] };
    drift: { count: number; items: DriftItem[] };
    outsideHours: { count: number; items: DriftItem[] };
    integrity: { count: number; breakdown: IntegrityIssue[] };
    attachments: { count: number; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };
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
  const add = (key: string, label: string, hits: BlockRow[]) => {
    issues.push({ key, label, count: hits.length, sampleBlockIds: hits.slice(0, MAX_ITEMS).map((b) => b.id) });
  };

  add("orphanJobPreset", "Osiřelý jobPreset (blok odkazuje na smazaný preset)",
    blocks.filter((b) => b.jobPresetId != null && !refs.jobPresetIds.has(b.jobPresetId)));
  add("invalidMachine", "Neplatný stroj",
    blocks.filter((b) => !machines.includes(b.machine)));
  add("invalidType", "Neplatný typ bloku",
    blocks.filter((b) => !VALID_TYPES.includes(b.type)));
  add("negativeInterval", "Konec ≤ začátek (nelogický interval)",
    blocks.filter((b) => b.endTime.getTime() <= b.startTime.getTime()));
  add("badPrintMinutes", "Vadné printMinutes (ZAKÁZKA)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.printMinutes != null &&
      (b.printMinutes <= 0 || b.printMinutes > MAX_PRINT_MINUTES || b.printMinutes % 30 !== 0)));
  add("unalignedStart", "Nezarovnaný start (mimo 30min mřížku)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.startTime.getTime() % SLOT_MS !== 0));
  add("inconsistentPrintCompleted", "Nekonzistentní dokončení tisku (jen jeden ze dvou údajů)",
    blocks.filter((b) => (b.printCompletedAt == null) !== (b.printCompletedByUserId == null)));

  return issues;
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

  const drifted = await detectCalendarDrift(
    db, [...MACHINES], now, new Date(now.getTime() + DRIFT_HORIZON_DAYS * DAY_MS), now,
  );
  const { drift, outsideHours } = bucketDrift(drifted);
  const overlaps = computeOverlapPairs(blocks, now);
  const integrity = computeIntegrityIssues(blocks, refs);
  const attach = diffAttachmentFiles(attachmentRows, await scanAttachmentDir(ATTACHMENTS_DIR));
  const integrityCount = integrity.reduce((s, i) => s + i.count, 0);

  return {
    checkedAt: now.toISOString(),
    checks: {
      overlaps: { count: overlaps.length, items: overlaps.slice(0, MAX_ITEMS) },
      drift: { count: drift.length, items: drift.slice(0, MAX_ITEMS) },
      outsideHours: { count: outsideHours.length, items: outsideHours.slice(0, MAX_ITEMS) },
      integrity: { count: integrityCount, breakdown: integrity },
      attachments: {
        count: attach.missingFiles.length + attach.orphanFiles.length,
        missingFiles: attach.missingFiles,
        orphanFiles: attach.orphanFiles,
      },
    },
  };
}
