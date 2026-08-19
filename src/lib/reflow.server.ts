import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { loadMachineCalendarRange, type MachineCalendar } from "@/lib/printTime.server";
import {
  expandPrintTime,
  isMachineRunnableAt,
  snapStartToNextRunnableSlot,
  MAX_SPAN_DAYS,
  SLOT_MS,
} from "@/lib/printTime";
import { resolveChainPushFromDb, type AppliedMove } from "@/lib/overlapResolver.server";
import { detectCalendarDrift } from "@/lib/calendarDrift.server";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { moveToBefore, mergeBefore, type ReflowBeforeSnapshot } from "@/lib/reflowBefore.server";
import { measureCascade } from "@/lib/cascadeLimit";
import { assertCascadeConfirmed } from "@/lib/cascadeLimit.server";

/** Strukturální podmnožina tx potřebná pro reflow — findUnique/update na Block + auditLog.create. */
export type TxLike = PrismaTransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Max posun STARTU při hledání nejbližšího runnable slotu — parita s auto-shiftem. */
export const REFLOW_MAX_START_SHIFT_DAYS = 7;

/** Okno detekce driftu pro hromadný reflow per stroj — [now, now + 365d). */
export const MACHINE_REFLOW_WINDOW_DAYS = 365;

export type ReflowOutcome =
  | {
      ok: true;
      changed: boolean;
      startTime: Date;
      endTime: Date;
      moves: AppliedMove[];
      /**
       * Poziční stav VŠECH dotčených bloků před přepočtem — přepočítaný blok sám
       * i každý, který odsunul jeho chain push. Prázdné, když se nic nezměnilo.
       */
      before: ReflowBeforeSnapshot[];
    }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_ZAKAZKA" | "LOCKED" | "PRINTED" | "NO_PM" | "UNALIGNED" | "NO_SLOT" | "HORIZON";
      message: string;
    };

export type ReflowDeps = {
  resolveChainPush: typeof resolveChainPushFromDb;
  /**
   * Volitelný předem načtený kalendář — použije se MÍSTO per-blok
   * `loadMachineCalendarRange`, když je předaný (výkonová optimalizace pro hromadný
   * reflow: 1 kalendář místo N per-blok fetchů). Volající RUČÍ za pokrytí okna
   * [start−1d, start+REFLOW_MAX_START_SHIFT_DAYS+MAX_SPAN_DAYS dní] pro KAŽDÝ blok,
   * který s tímto kalendářem projde přes `reflowBlockInTx` — nedostatečně široký
   * kalendář se TICHÝM PÁDEM přemapuje na `isHardcodedBlocked` fallback uvnitř
   * `expandPrintTime`/`isMachineRunnableAt` (chybějící týden ve `weekShifts` ⇒
   * fallback rozvrh, ne chyba). Když `preloadedCalendar` chybí, `reflowBlockInTx`
   * si kalendář načte sám (per-blok, jako dřív).
   */
  preloadedCalendar?: MachineCalendar;
  /**
   * `cascadeConfirmed` — uživatel velkou kaskádu odklepl v dialogu. Je to
   * request-scoped údaj (přišel z těla HTTP requestu), ne injektovaný
   * spolupracovník jako zbytek `deps` — sedí v tomhle bagu z praktických
   * důvodů (protéká až k `resolveChainPush`), ne z principu.
   */
  cascadeConfirmed?: boolean;
  /**
   * Protéká do `resolveChainPush` jako `skipCascadeCheck`. Sám `reflowBlockInTx`
   * default false (jednoblokový endpoint `/api/blocks/[id]/reflow` ho neposílá,
   * takže path "reflow-block" si kaskádu kontroluje sám) — `reflowMachineInTx`
   * ho nastaví na `true`, protože u hromadného přepočtu rozhoduje součet za
   * celý běh (path "reflow-machine"), ne každé jednotlivé volání.
   */
  skipCascadeCheck?: boolean;
};

const defaultDeps: ReflowDeps = { resolveChainPush: resolveChainPushFromDb };

/**
 * Přepočítá jeden ZAKAZKA blok podle aktuálního kalendáře stroje (start-only snap +
 * expandPrintTime) — akce plánovače „Přepočítat" pro drift mezi uloženým end a tím, co
 * by dnes vyšlo z tiskových hodin (kalendář se změnil po uložení bloku).
 *
 * Idempotentní: blok, který už na kalendář sedí a nenese značku „odložené mimo pracovní
 * dobu", nezapisuje nic (žádný update, žádný audit, žádný chain push) — vrací
 * `{ ok: true, changed: false }`.
 *
 * Odložené bloky (`scheduleBypassed`) se do 8/2026 odmítaly s `code: "BYPASS"`, takže
 * plánovač neměl jak takovou zakázku vrátit do kalendáře jinak než ručním tažením.
 * Nově se přepočítají jako každý jiný a značka se přitom RUŠÍ — je to jediná cesta,
 * kterou příznak z bloku mizí, a spouští ji vždy klik uživatele, nikdy ne aplikace sama.
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

  // Snapshot samotného přepočítávaného bloku — bere se PŘED update, protože
  // `scheduleBypassed` se u něj může zrušit a Ctrl+Z ho musí vrátit i s příznakem.
  const selfBefore: ReflowBeforeSnapshot = {
    id: blockId,
    startTime: oldStart.toISOString(),
    endTime: oldEnd.toISOString(),
    machine: block.machine,
    updatedAt: block.updatedAt.toISOString(),
    printMinutes: block.printMinutes,
    scheduleBypassed: block.scheduleBypassed,
  };

  // Kalendář pro celé okno, které reflow může potřebovat: až REFLOW_MAX_START_SHIFT_DAYS
  // dní hledání runnable startu + worst-case MAX_SPAN_DAYS expanze za ním. Když volající
  // (typicky reflowMachineInTx) předal preloadedCalendar, použije se ten místo per-blok
  // fetchu — viz precondition u ReflowDeps.preloadedCalendar.
  let cal: MachineCalendar;
  if (deps.preloadedCalendar) {
    cal = deps.preloadedCalendar;
  } else {
    const calendarEnd = new Date(oldStart.getTime() + (REFLOW_MAX_START_SHIFT_DAYS + MAX_SPAN_DAYS) * DAY_MS);
    cal = await loadMachineCalendarRange(tx, block.machine, oldStart, calendarEnd);
  }

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

  // Dvě nezávislé věci, které přepočet může spravit: geometrii (`moved`) a zbytkovou
  // značku „odložené mimo pracovní dobu" (`clearsFlag`). Zbytková značka je právě
  // ten případ, kdy se nic nepohne a přesto je co zapsat — kdyby `changed` viselo
  // jen na posunu, tlačítko by hlásilo úspěch a příznak by v DB zůstal (zakázka 18447).
  const moved = newStart.getTime() !== oldStart.getTime() || newEnd.getTime() !== oldEnd.getTime();
  const clearsFlag = block.scheduleBypassed === true;
  if (!moved && !clearsFlag) {
    return { ok: true, changed: false, startTime: oldStart, endTime: oldEnd, moves: [], before: [] };
  }

  await tx.block.update({
    where: { id: blockId },
    data: {
      ...(moved ? { startTime: newStart, endTime: newEnd } : {}),
      ...(clearsFlag ? { scheduleBypassed: false } : {}),
    },
  });

  // Když se nic nepohnulo, není co odsouvat, co kontrolovat na překryv ani co zapsat
  // do auditu jako přesun — samotné zrušení značky zaznamená revize bloku (černá
  // skříňka), která na `scheduleBypassed` má vlastní českou větu.
  if (!moved) {
    return { ok: true, changed: true, startTime: oldStart, endTime: oldEnd, moves: [], before: [selfBefore] };
  }

  // Chain push navazujících bloků — kolize se zamčeným/vytištěným následníkem hází
  // AppError, záměrně NECHYTÁNO zde: bublá do route, transakce se odvolá.
  const moves = await deps.resolveChainPush(
    tx, block.machine, { id: blockId, startTime: newStart, endTime: newEnd },
    new Set<number>(), new Set<number>(),
    {
      cascadeConfirmed: deps.cascadeConfirmed === true,
      path: "reflow-block",
      skipCascadeCheck: deps.skipCascadeCheck === true,
    },
  );

  // Finální tvrdá pojistka — reflow (re-expanze + chain push) nesmí skončit překryvem.
  // Parita s POST/PUT/batch/split; jediná záruka souběhu v této transakci.
  await assertNoOverlapForBlocks(block.machine, [blockId, ...moves.map((m) => m.id)], tx);

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

  return {
    ok: true,
    changed: true,
    startTime: newStart,
    endTime: newEnd,
    moves,
    before: [selfBefore, ...moves.map((m) => moveToBefore(block.machine, m))],
  };
}

export type MachineReflowResult = {
  reflowed: Array<{ id: number; orderNumber: string }>;
  skipped: Array<{ id: number; orderNumber: string; reason: string }>;
  /** Unikátní id VŠECH bloků odsunutých chain pushem během tohoto běhu (bez reflownutých
   * samotných) — route je potřebuje pro jeden souhrnný refetch + SSE payload. */
  movedIds: number[];
  /**
   * Poziční stav VŠECH dotčených bloků na ZAČÁTKU přepočtu stroje. Slučuje se
   * přes `mergeBefore` (první výskyt vyhrává) — jeden blok může být během běhu
   * dotčen víckrát a krok historie musí vrátit výchozí stav, ne mezistav.
   */
  before: ReflowBeforeSnapshot[];
};

export type ReflowMachineDeps = {
  reflowBlock: typeof reflowBlockInTx;
  detectDrift: typeof detectCalendarDrift;
  /**
   * `cascadeConfirmed` — uživatel velkou kaskádu odklepl v dialogu. Je to
   * request-scoped údaj (přišel z těla HTTP requestu), ne injektovaný
   * spolupracovník jako zbytek `deps` — sedí v tomhle bagu z praktických
   * důvodů (protéká do každého `reflowBlock` volání i do součtu za celý
   * běh), ne z principu.
   */
  cascadeConfirmed?: boolean;
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
 *
 * Výkon: kalendář stroje se načte NEJVÝŠE JEDNOU (přeskočeno úplně, když `drifted` je
 * prázdné — no-op nepotřebuje žádný kalendář). Dolní kotva NENÍ jen `now−1d`: detekce
 * driftu vrací i BĚŽÍCÍ bloky, jejichž `startTime` je hluboko v minulosti (podmínka
 * `detectCalendarDrift` je `startTime < windowEnd && endTime > max(windowStart, now)` —
 * start běžícího bloku může být až ~MACHINE_REFLOW_WINDOW_DAYS zpět). `reflowBlockInTx`
 * pro takový blok potřebuje kalendář pokrývající `[startTime−1d, ...]` (precondition
 * `ReflowDeps.preloadedCalendar`), takže kotva je `min(now−1d, nejstarší drifted
 * startTime)` — `drifted` je seřazené `startTime` asc (viz `detectCalendarDrift`), takže
 * stačí `drifted[0]`. Horní kotva zůstává [now + (365+7+21) dní] (pokrývá `now` i
 * worst-case posun startu o REFLOW_MAX_START_SHIFT_DAYS a expanzi MAX_SPAN_DAYS za
 * NEJPOZDĚJŠÍM driftnutým blokem v okně) a předá se přes `preloadedCalendar` do každého
 * `reflowBlockInTx` volání — místo aby si každý z N driftnutých bloků tahal vlastní
 * kalendář zvlášť.
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

  let preloadedCalendar: MachineCalendar | undefined;
  if (drifted.length > 0) {
    // Dolní kotva musí sahat i za NEJSTARŠÍ driftnutý blok, ne jen za `now−1d` — běžící
    // blok může mít start až ~MACHINE_REFLOW_WINDOW_DAYS dní zpět (detekce driftu ho
    // pořád vidí, dokud jeho endTime > now). `drifted[0]` je nejstarší díky asc řazení
    // v `detectCalendarDrift`. `loadMachineCalendarRange` si k `from` sama přidá interní
    // −1d kotvu (noční směna přes půlnoc), takže tady žádné další odečítání není třeba.
    const calendarStart = new Date(Math.min(now.getTime() - DAY_MS, drifted[0]!.startTime.getTime()));
    // Okno musí pokrýt worst-case blok: start až na hraně okna 365 d, forward snap
    // až +REFLOW_MAX_START_SHIFT_DAYS a expanze až +MAX_SPAN_DAYS — jinak by konec
    // expanze tiše spadl na hardcoded fallback a divergoval od per-blok cesty.
    const calendarEnd = new Date(
      now.getTime() + (MACHINE_REFLOW_WINDOW_DAYS + REFLOW_MAX_START_SHIFT_DAYS + MAX_SPAN_DAYS) * DAY_MS
    );
    preloadedCalendar = await loadMachineCalendarRange(tx, machine, calendarStart, calendarEnd);
  }

  const reflowed: MachineReflowResult["reflowed"] = [];
  const skipped: MachineReflowResult["skipped"] = [];
  const movedIdSet = new Set<number>();
  const beforeById = new Map<number, ReflowBeforeSnapshot>();
  const cascadeConfirmed = deps.cascadeConfirmed === true;
  const allMoves: AppliedMove[] = [];

  for (const block of drifted) {
    const outcome = await deps.reflowBlock(tx, block.id, actor, {
      resolveChainPush: resolveChainPushFromDb,
      preloadedCalendar,
      cascadeConfirmed,
      // Hromadný přepočet stroje kontroluje kaskádu na SOUČTU za celý běh (path
      // "reflow-machine" níž) — per-blok kontrola by u prvního driftnutého bloku
      // vyhodila výjimku s číslem jen z něj a "reflow-block" by se navíc v logu
      // objevovalo i pro tohle gesto, ne jen pro skutečné jednoblokové Přepočítat.
      skipCascadeCheck: true,
    });
    if (!outcome.ok) {
      skipped.push({ id: block.id, orderNumber: block.orderNumber, reason: outcome.code });
      continue;
    }
    if (!outcome.changed) continue;
    reflowed.push({ id: block.id, orderNumber: block.orderNumber });
    for (const move of outcome.moves) movedIdSet.add(move.id);
    allMoves.push(...outcome.moves);
    mergeBefore(beforeById, outcome.before);
  }

  // Součet přes celý běh: každý blok si chain push kontroluje sám, ale hromadný
  // přepočet jich spustí desítky — a uživatele zajímá dopad CELÉHO tlačítka.
  assertCascadeConfirmed(measureCascade(allMoves), {
    confirmed: cascadeConfirmed, path: "reflow-machine", machine,
  });

  return { reflowed, skipped, movedIds: [...movedIdSet], before: [...beforeById.values()] };
}
