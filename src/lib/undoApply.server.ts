import { AppError } from "@/lib/errors";
import { isRestorableField } from "@/lib/undo/restoreFields";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { logger } from "@/lib/logger";
import { SLOT_MS } from "@/lib/timeSlots";

export type UndoOp =
  | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };

export type UndoDirection = "undo" | "redo";

/** Sloupce bez defaultu a bez `?` — bez nich Prisma create neprojde. */
export const REQUIRED_ON_CREATE = ["orderNumber", "machine", "startTime", "endTime"] as const;

function bad(message: string): never {
  throw new AppError("VALIDATION_ERROR", message);
}

/**
 * Jediná brána mezi tělem requestu a transakcí. Endpoint NESMÍ být univerzální
 * zápis do Block — všechno, co projde sem, se zapíše doslova bez další validace.
 */
export function sanitizeUndoOps(raw: unknown): UndoOp[] {
  if (!Array.isArray(raw) || raw.length === 0) bad("Seznam operací je prázdný nebo není pole.");
  if (raw.length > 200) bad("Seznam operací je příliš dlouhý (max 200).");

  const seen = new Set<number>();
  const ops: UndoOp[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) bad("Operace není objekt.");
    const o = item as Record<string, unknown>;

    if (!Number.isInteger(o.id) || (o.id as number) <= 0 || (o.id as number) > 2147483647) bad(`Neplatné id bloku: ${String(o.id)}`);
    const id = o.id as number;
    if (seen.has(id)) bad(`Blok ${id} je v dávce vícekrát — undo musí mít na blok jedinou operaci.`);
    seen.add(id);

    let expectedUpdatedAt: string | undefined;
    if (o.expectedUpdatedAt !== undefined) {
      if (typeof o.expectedUpdatedAt !== "string" || Number.isNaN(new Date(o.expectedUpdatedAt).getTime())) {
        bad(`Neplatné expectedUpdatedAt u bloku ${id}.`);
      }
      expectedUpdatedAt = o.expectedUpdatedAt;
    }

    if (o.kind === "remove") {
      ops.push({ kind: "remove", id, expectedUpdatedAt });
      continue;
    }
    if (o.kind !== "upsert") bad(`Neznámá operace: ${String(o.kind)}`);

    if (typeof o.fields !== "object" || o.fields === null || Array.isArray(o.fields)) {
      bad(`Chybí fields u bloku ${id}.`);
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(o.fields as Record<string, unknown>)) {
      if (!isRestorableField(key)) bad(`Pole "${key}" undo obnovovat nesmí (blok ${id}).`);
      // Hodnota musí být primitivum (string, number, boolean, null), ne objekt ani pole.
      // Prisma by atomické operace jako { increment: 999 } interpretoval špatně.
      if (typeof value === "object" && value !== null) {
        bad(`Pole "${key}" má neplatný formát (pole nebo objekt), povolena jsou jen primitiva: blok ${id}.`);
      }
      fields[key] = value;
    }
    ops.push({ kind: "upsert", id, expectedUpdatedAt, fields });
  }
  return ops;
}

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

export type UndoActor = { id: number; username: string };
export type UndoApplyResult = { updatedIds: number[]; createdIds: number[]; removedIds: number[] };

const span = (start: unknown, end: unknown) =>
  `${new Date(start as string).toISOString()}–${new Date(end as string).toISOString()}`;

/**
 * Provede celou undo dávku. Volá se UVNITŘ `prisma.$transaction` — buď projde
 * celá, nebo se rollbackne a nezmění se nic.
 *
 * ZÁMĚRNĚ NEVOLÁ `validateAndComputeEnd`. Undo vrací stav, který v DB
 * prokazatelně existoval; měřit ho dnešními pravidly je kategorická chyba
 * (přesně to dnes rozbíjí návrat bloků mimo 30min mřížku). Endpoint nevolá
 * ani `expandPrintTime`, takže mřížkovou bránu nepotřebuje — ta je jen
 * předsazená pojistka před tvrdým throwem uvnitř expanze.
 *
 * Co běží VŽDY: optimistic lock, zákaz smazat vytištěný blok a finální
 * `assertNoOverlapForBlocks`. Rané overlap kontroly se nespouštějí vůbec —
 * mezistavy uvnitř transakce nikdo nevidí, takže na pořadí operací nezáleží.
 */
export async function applyUndoOps(
  tx: PrismaTransactionClient,
  ops: UndoOp[],
  actor: UndoActor,
  label: string,
  direction: UndoDirection,
): Promise<UndoApplyResult> {
  const ids = ops.map((o) => o.id);
  const existing = await tx.block.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, updatedAt: true, printCompletedAt: true },
  });
  const byId = new Map(existing.map((b) => [b.id, b]));

  // ── 1. Optimistic lock — VŠECHNY najednou, PŘED prvním zápisem ───────────
  const stale: number[] = [];
  for (const op of ops) {
    if (!op.expectedUpdatedAt) continue;
    const row = byId.get(op.id);
    if (!row) continue; // chybějící řádek řeší větev create / idempotentní remove
    if (row.updatedAt.getTime() !== new Date(op.expectedUpdatedAt).getTime()) stale.push(op.id);
  }
  if (stale.length > 0) {
    throw new AppError("CONFLICT", `Bloky byly mezitím změněny jiným uživatelem: ${stale.join(", ")}`);
  }

  // ── 2. Business pravidlo: vytištěný blok se nemaže ───────────────────────
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const row = byId.get(op.id);
    if (row?.printCompletedAt) {
      throw new AppError(
        "CONFLICT",
        `Tisk bloku #${row.orderNumber ?? row.id} mezitím potvrdil tiskař — vrácení zpět by smazalo hotovou práci.`,
      );
    }
  }

  // ── 3. Povinná pole u vytvoření ──────────────────────────────────────────
  for (const op of ops) {
    if (op.kind !== "upsert" || byId.has(op.id)) continue;
    const missing = REQUIRED_ON_CREATE.filter((f) => op.fields[f] === undefined || op.fields[f] === null);
    if (missing.length > 0) {
      throw new AppError("VALIDATION_ERROR", `Obnova bloku ${op.id} nemá povinná pole: ${missing.join(", ")}.`);
    }
  }

  const result: UndoApplyResult = { updatedIds: [], createdIds: [], removedIds: [] };
  const auditRows: Record<string, unknown>[] = [];
  // Kontrola PER STROJ (vzor `checkByMachine` z batch/route.ts) — assertNoOverlapForBlocks
  // filtruje `machine = ?` uvnitř sebe, takže smí dostat jen id bloků, které na ten stroj
  // skutečně patří. Plochý seznam všech upsertnutých id předaný do KAŽDÉHO stroje by při
  // dávce přes víc strojů srovnával cizí časová okna a hlásil falešné kolize.
  const idsByMachine = new Map<string, number[]>();
  const addToMachine = (machine: string, id: number) => {
    const arr = idsByMachine.get(machine) ?? [];
    arr.push(id);
    idsByMachine.set(machine, arr);
  };

  // ── 4. Nejdřív mazání (uvolní místo), pak zápisy ─────────────────────────
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const row = byId.get(op.id);
    if (!row) continue; // idempotence: co neexistuje, je už smazané
    await tx.block.delete({ where: { id: op.id } });
    result.removedIds.push(op.id);
    auditRows.push({
      blockId: op.id, orderNumber: row.orderNumber, userId: actor.id, username: actor.username,
      action: direction === "undo" ? "UNDO" : "REDO",
      field: "delete", oldValue: span(row.startTime, row.endTime), newValue: null,
    });
  }

  for (const op of ops) {
    if (op.kind !== "upsert") continue;
    const row = byId.get(op.id);
    const data = toPrismaData(op.fields);

    if (row) {
      const saved = await tx.block.update({ where: { id: op.id }, data });
      result.updatedIds.push(op.id);
      addToMachine(saved.machine, op.id);
      auditRows.push({
        blockId: op.id, orderNumber: saved.orderNumber, userId: actor.id, username: actor.username,
        action: direction === "undo" ? "UNDO" : "REDO",
        field: "startTime/endTime/machine",
        oldValue: span(row.startTime, row.endTime),
        newValue: span(saved.startTime, saved.endTime),
      });
    } else {
      // Obnova s PŮVODNÍM id — historie v AuditLogu a notifikace zůstanou
      // navázané. MySQL AUTO_INCREMENT se explicitním vložením nižší hodnoty
      // nesnižuje, takže budoucí kolize nehrozí.
      const saved = await tx.block.create({ data: { ...data, id: op.id } as never });
      result.createdIds.push(op.id);
      addToMachine(saved.machine, op.id);
      auditRows.push({
        blockId: op.id, orderNumber: saved.orderNumber, userId: actor.id, username: actor.username,
        action: direction === "undo" ? "UNDO" : "REDO",
        field: "restore", oldValue: null, newValue: span(saved.startTime, saved.endTime),
      });
    }

    warnIfUnusual(op);
  }

  if (auditRows.length > 0) await tx.auditLog.createMany({ data: auditRows as never });

  // ── 5. Finální pojistka — běží VŽDY, bez únikové cesty ───────────────────
  // Stroje z CÍLOVÉHO stavu, každý jen se svými id: funkce filtruje `machine = ?`,
  // takže přesun na jiný stroj musí kontrolovat ten nový, a id musí patřit tomu
  // stroji, který se zrovna kontroluje (jinak by srovnávala časová okna napříč
  // nesouvisejícími stroji). Stroje, ze kterých se jen odcházelo, kontrolu
  // nepotřebují — uvolněné místo překryv nevyrobí.
  for (const [machine, ids] of idsByMachine) {
    await assertNoOverlapForBlocks(machine, ids, tx);
  }

  logger.info(`[undo] ${direction} "${label}" — ${result.updatedIds.length} upraveno, ${result.createdIds.length} obnoveno, ${result.removedIds.length} smazáno`);
  return result;
}

/** Datumové sloupce přicházejí jako ISO string; Prisma chce Date. */
const DATE_FIELDS = new Set([
  "startTime", "endTime", "deadlineExpedice", "dataRequiredDate",
  "materialRequiredDate", "pantoneRequiredDate", "expeditionPublishedAt",
]);

function toPrismaData(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

/** Obnova mimo mřížku je legitimní (legacy bloky), ale produkce o ní má vědět. */
function warnIfUnusual(op: Extract<UndoOp, { kind: "upsert" }>): void {
  const start = op.fields.startTime;
  if (typeof start !== "string") return;
  const t = new Date(start).getTime();
  if (!Number.isNaN(t) && t % SLOT_MS !== 0) {
    logger.warn(`[undo] blok ${op.id} obnoven na start mimo 30min mřížku (${start}) — legacy blok před modelem tiskových hodin`);
  }
}
