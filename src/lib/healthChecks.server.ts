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
  splitGroupId: number | null;
  reservationId: number | null;
  jobPresetId: number | null;
  recurrenceParentId: number | null;
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
  splitGroupIds: Set<number>;
  reservationIds: Set<number>;
  jobPresetIds: Set<number>;
  blockIds: Set<number>;
};

/** Osiřelé vazby + neplatné hodnoty. Čistá funkce nad načtenými bloky a množinami ID. */
export function computeIntegrityIssues(blocks: BlockRow[], refs: IntegrityRefs): IntegrityIssue[] {
  const machines = MACHINES as readonly string[];
  const issues: IntegrityIssue[] = [];
  const add = (key: string, label: string, hits: BlockRow[]) => {
    issues.push({ key, label, count: hits.length, sampleBlockIds: hits.slice(0, MAX_ITEMS).map((b) => b.id) });
  };

  add("orphanJobPreset", "Osiřelý jobPreset (blok odkazuje na smazaný preset)",
    blocks.filter((b) => b.jobPresetId != null && !refs.jobPresetIds.has(b.jobPresetId)));
  add("orphanSplitGroup", "Osiřelá split-skupina",
    blocks.filter((b) => b.splitGroupId != null && !refs.splitGroupIds.has(b.splitGroupId)));
  add("orphanReservation", "Osiřelá rezervace",
    blocks.filter((b) => b.reservationId != null && !refs.reservationIds.has(b.reservationId)));
  add("orphanRecurrenceParent", "Osiřelý rodič opakování",
    blocks.filter((b) => b.recurrenceParentId != null && !refs.blockIds.has(b.recurrenceParentId)));
  add("invalidMachine", "Neplatný stroj",
    blocks.filter((b) => !machines.includes(b.machine)));
  add("invalidType", "Neplatný typ bloku",
    blocks.filter((b) => !VALID_TYPES.includes(b.type)));
  add("negativeInterval", "Konec ≤ začátek (nelogický interval)",
    blocks.filter((b) => b.endTime.getTime() <= b.startTime.getTime()));
  add("badPrintMinutes", "Vadné printMinutes (ZAKAZKA)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.printMinutes != null &&
      (b.printMinutes <= 0 || b.printMinutes > MAX_PRINT_MINUTES || b.printMinutes % 30 !== 0)));
  add("unalignedStart", "Nezarovnaný start (mimo 30min mřížku)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.startTime.getTime() % SLOT_MS !== 0));

  // split-skupina < 2 bloky (i prázdné skupiny přítomné v refs.splitGroupIds)
  const membersByGroup = new Map<number, number[]>();
  for (const b of blocks) {
    if (b.splitGroupId == null) continue;
    const arr = membersByGroup.get(b.splitGroupId) ?? [];
    arr.push(b.id);
    membersByGroup.set(b.splitGroupId, arr);
  }
  const undersizedSamples: number[] = [];
  let undersizedCount = 0;
  for (const gid of refs.splitGroupIds) {
    const members = membersByGroup.get(gid) ?? [];
    if (members.length < 2) {
      undersizedCount++;
      if (undersizedSamples.length < MAX_ITEMS && members[0] != null) undersizedSamples.push(members[0]);
    }
  }
  issues.push({ key: "undersizedSplitGroup", label: "Split-skupina s méně než 2 bloky", count: undersizedCount, sampleBlockIds: undersizedSamples });

  return issues;
}
