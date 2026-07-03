import { loadMachineCalendarRange } from "@/lib/printTime.server";
import {
  expandPrintTime,
  isMachineRunnableAt,
  snapStartToNextRunnableSlot,
  MAX_SPAN_DAYS,
  SLOT_MS,
} from "@/lib/printTime";
import { resolveChainPushFromDb, type AppliedMove } from "@/lib/overlapResolver.server";
import { detectCalendarDrift } from "@/lib/calendarDrift.server";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

/** Strukturální podmnožina tx potřebná pro reflow — findUnique/update na Block + auditLog.create. */
export type TxLike = PrismaTransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Max posun STARTU při hledání nejbližšího runnable slotu — parita s auto-shiftem. */
export const REFLOW_MAX_START_SHIFT_DAYS = 7;

/** Okno detekce driftu pro hromadný reflow per stroj — [now, now + 365d). */
export const MACHINE_REFLOW_WINDOW_DAYS = 365;

export type ReflowOutcome =
  | { ok: true; changed: boolean; startTime: Date; endTime: Date; moves: AppliedMove[] }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_ZAKAZKA" | "BYPASS" | "LOCKED" | "PRINTED" | "NO_PM" | "UNALIGNED" | "NO_SLOT" | "HORIZON";
      message: string;
    };

export type ReflowDeps = {
  resolveChainPush: typeof resolveChainPushFromDb;
};

const defaultDeps: ReflowDeps = { resolveChainPush: resolveChainPushFromDb };

/**
 * Přepočítá jeden ZAKAZKA blok podle aktuálního kalendáře stroje (start-only snap +
 * expandPrintTime) — akce plánovače „Přepočítat" pro drift mezi uloženým end a tím, co
 * by dnes vyšlo z tiskových hodin (kalendář se změnil po uložení bloku).
 *
 * Idempotentní: blok, který už na kalendář sedí, nezapisuje nic (žádný update, žádný
 * audit, žádný chain push) — vrací `{ ok: true, changed: false }`.
 *
 * Reflownutý blok sám NEPODLÉHÁ MIN_PRINT_SEGMENT_MINUTES (explicitní ruční akce);
 * navazující bloky odsunuté chain pushem si svá pravidla drží beze změny.
 *
 * Kolize se zamčeným/vytištěným NÁSLEDNÍKEM (uvnitř resolveChainPushFromDb) hází
 * AppError — NENÍ zde chytáno, bublá do route a celá transakce se odvolá.
 */
export async function reflowBlockInTx(
  tx: TxLike,
  blockId: number,
  actor: { id: number; username: string },
  deps: ReflowDeps = defaultDeps
): Promise<ReflowOutcome> {
  const block = await tx.block.findUnique({ where: { id: blockId } });
  if (!block) {
    return { ok: false, code: "NOT_FOUND", message: "Blok nenalezen" };
  }
  if (block.type !== "ZAKAZKA") {
    return { ok: false, code: "NOT_ZAKAZKA", message: "Lze přepočítat jen blok typu zakázka." };
  }
  if (block.scheduleBypassed) {
    return { ok: false, code: "BYPASS", message: "Blok s vypnutým zámkem se nepřepočítává." };
  }
  if (block.locked) {
    return { ok: false, code: "LOCKED", message: "Zamčený blok nelze přepočítat — nejdřív ho odemkni." };
  }
  if (block.printCompletedAt) {
    return { ok: false, code: "PRINTED", message: "Vytištěný blok nelze přepočítat." };
  }
  if (block.printMinutes == null || block.printMinutes <= 0) {
    return { ok: false, code: "NO_PM", message: "Blok nemá platné tiskové minuty." };
  }
  if (block.startTime.getTime() % SLOT_MS !== 0) {
    return { ok: false, code: "UNALIGNED", message: "Start bloku neleží na 30min hranici." };
  }

  const oldStart = block.startTime;
  const oldEnd = block.endTime;
  const pm = block.printMinutes;

  // Kalendář pro celé okno, které reflow může potřebovat: až REFLOW_MAX_START_SHIFT_DAYS
  // dní hledání runnable startu + worst-case MAX_SPAN_DAYS expanze za ním.
  const calendarEnd = new Date(oldStart.getTime() + (REFLOW_MAX_START_SHIFT_DAYS + MAX_SPAN_DAYS) * DAY_MS);
  const cal = await loadMachineCalendarRange(tx, block.machine, oldStart, calendarEnd);

  let newStart: Date;
  if (isMachineRunnableAt(block.machine, oldStart, cal.weekShifts, cal.companyDays)) {
    newStart = oldStart;
  } else {
    const limitMs = oldStart.getTime() + REFLOW_MAX_START_SHIFT_DAYS * DAY_MS;
    const snapped = snapStartToNextRunnableSlot(block.machine, oldStart, cal.weekShifts, cal.companyDays, limitMs);
    if (!snapped) {
      return { ok: false, code: "NO_SLOT", message: "Do 7 dnů není volný provozní slot." };
    }
    newStart = snapped;
  }

  const exp = expandPrintTime(block.machine, newStart, pm, cal.weekShifts, cal.companyDays, false);
  if (!exp.ok) {
    // Start je runnable (buď původní, nebo ze snapu) → jediný možný reason je HORIZON_EXCEEDED.
    return { ok: false, code: "HORIZON", message: "Blok přesahuje horizont plánování — uvolni místo ručně." };
  }
  const newEnd = exp.end;

  const changed = newStart.getTime() !== oldStart.getTime() || newEnd.getTime() !== oldEnd.getTime();
  if (!changed) {
    return { ok: true, changed: false, startTime: oldStart, endTime: oldEnd, moves: [] };
  }

  await tx.block.update({
    where: { id: blockId },
    data: { startTime: newStart, endTime: newEnd },
  });

  // Chain push navazujících bloků — kolize se zamčeným/vytištěným následníkem hází
  // AppError, záměrně NECHYTÁNO zde: bublá do route, transakce se odvolá.
  const moves = await deps.resolveChainPush(tx, block.machine, { id: blockId, startTime: newStart, endTime: newEnd });

  // Audit odsunutých navazujících bloků — jeden AUTO_SHIFT řádek per posunutý blok (vzor
  // PUT `[id]/route.ts`). En-dash `–` (U+2013) v oldValue/newValue, NE ASCII pomlčka —
  // fmtAuditVal rozlišuje span podle tohoto přesného znaku.
  if (moves.length > 0) {
    await tx.auditLog.createMany({
      data: moves.map((m) => ({
        blockId: m.id,
        orderNumber: m.orderNumber,
        userId: actor.id,
        username: actor.username,
        action: "AUTO_SHIFT",
        field: "startTime/endTime",
        oldValue: `${m.oldStartTime.toISOString()}–${m.oldEndTime.toISOString()}`,
        newValue: `${m.startTime.toISOString()}–${m.endTime.toISOString()}`,
      })),
    });
  }

  await tx.auditLog.create({
    data: {
      blockId,
      orderNumber: block.orderNumber,
      userId: actor.id,
      username: actor.username,
      action: "AUTO_REFLOW",
      field: "startTime/endTime",
      oldValue: `${oldStart.toISOString()}–${oldEnd.toISOString()}`,
      newValue: `${newStart.toISOString()}–${newEnd.toISOString()}`,
    },
  });

  return { ok: true, changed: true, startTime: newStart, endTime: newEnd, moves };
}

export type MachineReflowResult = {
  reflowed: Array<{ id: number; orderNumber: string }>;
  skipped: Array<{ id: number; orderNumber: string; reason: string }>;
  /** Unikátní id VŠECH bloků odsunutých chain pushem během tohoto běhu (bez reflownutých
   * samotných) — route je potřebuje pro jeden souhrnný refetch + SSE payload. */
  movedIds: number[];
};

export type ReflowMachineDeps = {
  reflowBlock: typeof reflowBlockInTx;
  detectDrift: typeof detectCalendarDrift;
};

const defaultReflowMachineDeps: ReflowMachineDeps = {
  reflowBlock: reflowBlockInTx,
  detectDrift: detectCalendarDrift,
};

/**
 * Hromadné „Přepočítat" pro celý stroj — najde všechny bloky, jejichž uložený `endTime`
 * nesedí na aktuální kalendář (drift), a přepočítá je jeden po druhém, CHRONOLOGICKY
 * (`startTime` asc — v tomto pořadí je vrací `detectCalendarDrift`), aby chain push
 * dřívějšího bloku mohl ovlivnit pozici pozdějších PŘED jejich vlastním reflow.
 *
 * Okno detekce driftu je [now, now + MACHINE_REFLOW_WINDOW_DAYS dní).
 *
 * Guard selhání (`ok:false`) z `reflowBlockInTx` — LOCKED/PRINTED/NO_PM/UNALIGNED/
 * NO_SLOT/HORIZON — jsou vždy PŘED jakýmkoli zápisem (bezpečné skipovat a pokračovat
 * dalším blokem, žádný abort). `changed:false` (blok mezitím srovnal chain push
 * předchozího reflow v tomto běhu) se NEZAŘAZUJE ani do `reflowed`, ani do `skipped` —
 * z pohledu uživatele se nic nestalo, protože už nic dělat nebylo třeba.
 *
 * AppError z chain pushe (kolize se zamčeným/vytištěným následníkem) se NECHYTÁ —
 * bublá ven, celá transakce (volající `$transaction`) se odvolá. To je záměr: dílčí
 * částečně proběhlý reflow by byl matoucí, radši abort all s jasnou hláškou resolveru.
 */
export async function reflowMachineInTx(
  tx: TxLike,
  machine: string,
  actor: { id: number; username: string },
  now: Date,
  deps: ReflowMachineDeps = defaultReflowMachineDeps
): Promise<MachineReflowResult> {
  const windowEnd = new Date(now.getTime() + MACHINE_REFLOW_WINDOW_DAYS * DAY_MS);
  const drifted = await deps.detectDrift(tx, [machine], now, windowEnd, now);

  const reflowed: MachineReflowResult["reflowed"] = [];
  const skipped: MachineReflowResult["skipped"] = [];
  const movedIdSet = new Set<number>();

  for (const block of drifted) {
    const outcome = await deps.reflowBlock(tx, block.id, actor);
    if (!outcome.ok) {
      skipped.push({ id: block.id, orderNumber: block.orderNumber, reason: outcome.code });
      continue;
    }
    if (!outcome.changed) continue;
    reflowed.push({ id: block.id, orderNumber: block.orderNumber });
    for (const move of outcome.moves) movedIdSet.add(move.id);
  }

  return { reflowed, skipped, movedIds: [...movedIdSet] };
}
