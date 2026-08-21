import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { reflowMachineInTx, reflowBlockInTx } from "@/lib/reflow.server";
import { detectCalendarDrift } from "@/lib/calendarDrift.server";
import { emitSSE } from "@/lib/eventBus";
import { MACHINES } from "@/lib/machines";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";
import { withRevision } from "@/lib/revision.server";
import { cascadeConfirmBody } from "@/lib/cascadeResponse";
import { autoShiftExplicitlyOff, overlapMessageFor } from "@/lib/autoShiftOff";

/**
 * Per-machine in-flight guard proti self-DoS: přepočet celého stroje otevírá 365denní okno
 * a dlouhou transakci (timeout 30 s). Bez throttlingu by paralelní requesty na týž stroj
 * vyčerpaly connection pool. Když přepočet stroje už běží, druhý request dostane 409 a musí
 * počkat. Per-blok /[id]/reflow guard NEpotřebuje (krátká tx). Module-scope = per-instance
 * (produkce běží single-instance); `connection_limit` v DATABASE_URL řeší deploy checklist.
 */
const reflowInFlight = new Map<string, boolean>();

/**
 * Hromadné „Přepočítat" pro celý stroj — najde a přepočítá všechny ZAKAZKA bloky,
 * jejichž uložený `endTime` nesedí na aktuální kalendář (drift). Statická cesta
 * `/api/blocks/reflow` má v Next.js prioritu před dynamickou `/api/blocks/[id]` —
 * kolize jmen mezi segmenty není.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { machine?: string; cascadeConfirmed?: boolean; resolveChain?: boolean } | null;
  const machine = body?.machine;
  if (!machine || typeof machine !== "string" || !MACHINES.includes(machine as (typeof MACHINES)[number])) {
    return NextResponse.json({ error: `Neznámý stroj: ${machine ?? ""}` }, { status: 400 });
  }
  // cascadeConfirmed: uživatel velkou kaskádu odklepl v dialogu (zatím jen měření — CASCADE_CONFIRM_ENFORCED je false).
  const cascadeConfirmed = body?.cascadeConfirmed === true;
  // resolveChain: vypínač autoposunu (Task 6D). Přepočet celého stroje posouvá cizí bloky
  // stejně jako drag — chybějící příznak (starý klient) znamená ZAPNUTO, `false` chain push
  // pro celý běh vypne.
  const resolveChain = body?.resolveChain !== false;

  // In-flight guard — když přepočet TOHOTO stroje už běží, odmítni místo souběhu (self-DoS).
  if (reflowInFlight.get(machine)) {
    return NextResponse.json(
      { error: "Přepočet stroje už běží — počkej na dokončení." },
      { status: 409 }
    );
  }
  reflowInFlight.set(machine, true);

  try {
    // Transakci otevírá `withRevision` — každý přepočítaný blok i každý blok odsunutý
    // jeho chain pushem dostane vlastní revizi a všechny nesou shodné `groupId`, takže
    // se celý přepočet stroje dá v historii vzít zpět jako JEDEN krok. Auditní řádky
    // (AUTO_REFLOW + AUTO_SHIFT) dostanou `groupId` automaticky. UVNITŘ těla se nesmí
    // sáhnout na modulový `prisma` ani pro čtení (viz docblock withRevision).
    //
    // `txOptions` se předává VÝSLOVNĚ: tohle je nejdelší transakce v aplikaci (okno
    // 365 dnů, může se dotknout stovek bloků), výchozích 15 s pomocníka by nestačilo.
    const { result } = await withRevision(
      {
        action: "REFLOW",
        label: "Přepočet stroje",
        user: { id: session.id, username: session.username },
        txOptions: { timeout: 30000, maxWait: 5000 },
      },
      (tx) =>
        reflowMachineInTx(tx, machine, { id: session.id, username: session.username }, new Date(), {
          reflowBlock: reflowBlockInTx,
          detectDrift: detectCalendarDrift,
          cascadeConfirmed,
          resolveChain,
        }),
    );

    // Všechna dotčená id: reflownuté bloky + id bloků odsunutých jejich chain pushem
    // (reflowMachineInTx je sesbírá do movedIds). To platí BEZ garance vzájemné
    // výlučnosti napříč celým během stroje: movedIds je unie chain-push cílů ze VŠECH
    // volání reflowBlockInTx v tomto běhu, a jedno konkrétní volání do movedIds přidává
    // jen bloky, které ono samo odsunulo (ne sebe). Blok, který byl reflownutý dřív
    // v pořadí, ale později v běhu ho odsune chain push jiného bloku, tak skončí
    // v OBOU množinách zároveň — např. blok D (start 8:00) se přepočítá první a vlastním
    // snapem se posune až za blok F (start 14:00, přepočítá se později); F pak svým
    // chain pushem odsune D, takže D je v `reflowed` i v `movedIds`. `movedCount` níže
    // proto může být o odsunuté-a-zároveň-reflownuté bloky vyšší, než kolik bloků bylo
    // ve skutečnosti dotčeno — číslo v hlášce je tím nepřesné (viz `reflowMachineToast`),
    // datovou vadu to ale nezakládá.
    const reflowedIds = result.reflowed.map((r) => r.id);
    const allIds = [...new Set([...reflowedIds, ...result.movedIds])];

    if (allIds.length === 0) {
      return NextResponse.json({ reflowed: result.reflowed, skipped: result.skipped, movedCount: 0, blocks: [], before: [] });
    }

    const blocks = await prisma.block.findMany({
      where: { id: { in: allIds } },
      include: {
        Reservation: { select: { confirmedAt: true } },
        notes: { orderBy: { createdAt: "desc" as const } },
      },
    });
    const serializedBlocks = blocks.map(serializeBlock);

    // SSE broadcast nese notes plné — per-connection strip v /api/events je zahodí (D2b).
    emitSSE("block:batch-updated", { blocks: serializedBlocks, sourceUserId: session.id });

    // Odpověď mutujícímu — poznámky gate dle role (reflow je ADMIN/PLANOVAT-only, oba právo mají).
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    return NextResponse.json({
      reflowed: result.reflowed,
      skipped: result.skipped,
      movedCount: result.movedIds.length,
      blocks: serializedBlocks.map((b) => stripNotesIfDenied(b, canSeeNotes)),
      before: result.before,
    });
  } catch (error: unknown) {
    if (isAppError(error) && error.code === "CASCADE_CONFIRM") {
      return NextResponse.json(cascadeConfirmBody(error), { status: errorStatus(error.code) });
    }
    if (isAppError(error)) {
      logger.warn(`[POST /api/blocks/reflow] přepočet zastaven`, { machine, code: error.code, message: error.message });
      const message = error.code === "OVERLAP"
        ? overlapMessageFor(error.message, autoShiftExplicitlyOff(body))
        : error.message;
      return NextResponse.json(
        { error: `Přepočet zastaven: ${message}`, code: error.code },
        { status: errorStatus(error.code) }
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      logger.warn("[POST /api/blocks/reflow] transakce vypršela (P2028)", { machine });
      return NextResponse.json(
        { error: "Přepočet trval příliš dlouho — zkuste to znovu, případně po menších částech." },
        { status: 503 },
      );
    }
    logger.error("[POST /api/blocks/reflow]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  } finally {
    // Uvolnit guard VŽDY — i po chybě/timeoutu, jinak by stroj zůstal trvale zamčený.
    reflowInFlight.delete(machine);
  }
}
