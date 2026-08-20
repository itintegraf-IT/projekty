import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { validateAndComputeEnd } from "@/lib/scheduleValidationServer";
import { loadMachineCalendar } from "@/lib/printTime.server";
import { computeSplitPrintMinutes } from "@/lib/splitCompute";
import { resolveChainPushFromDb, type AppliedMove } from "@/lib/overlapResolver.server";
import { syncReservationScheduleForBlocks } from "@/lib/reservationSync.server";
import { moveToBefore } from "@/lib/reflowBefore.server";
import { cascadeConfirmBody } from "@/lib/cascadeResponse";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { emitSSE } from "@/lib/eventBus";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";
import { withRevision } from "@/lib/revision.server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Atomický split bloku — nahrazuje dřívější 3-request klientský orchestr (head PUT +
 * self-link PUT + tail POST s LIFO kompenzací). Vše v jedné transakci: vytvoří (nebo
 * převezme) `SplitGroup`, zkrátí hlavu, vytvoří ocas, chain push, finální pojistka.
 *
 * Invarianty (red-team B2):
 *  - HLAVA: endTime přes validateAndComputeEnd (NE syrový splitAt) — kalendářně honný
 *    end + effectivelyBypassed (jinak okamžitý END_MISMATCH drift u hlavy s pauzou).
 *  - TAIL: kopíruje VŠECHNA SPLIT_SHARED_FIELDS + per-blok produkční pole z hlavy
 *    (jinak vznikne nekonzistentní ocas — třída datového bugu #2).
 *  - Optimistic lock (expectedUpdatedAt) + in-tx re-read → dva souběžné splity téhož bloku
 *    se nepřekryjí; assertNoOverlapForBlocks jako finální tvrdá pojistka po chain pushi.
 *  - Audit: tail CREATE + AUTO_SHIFT (chain push); hlava BEZ generického UPDATE(endTime)
 *    řádku (parita s dneškem — endTime není v AUDITED_FIELDS; UPDATE by znečistil dashboard).
 *  - Poznámky: refetch head+tail+shifted s notes include (jeden zdroj pro SSE i response),
 *    do přímé odpovědi stripNotesIfDenied, do SSE plné (per-connection strip v /api/events).
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireRole(["ADMIN", "PLANOVAT"]);

    const { id: rawId } = await params;
    const id = parseInt(rawId, 10);
    if (isNaN(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID");

    const body = await request.json();
    const splitAt = new Date(body.splitAt);
    if (isNaN(splitAt.getTime())) throw new AppError("VALIDATION_ERROR", "Neplatný čas rozdělení (splitAt).");
    const expectedUpdatedAt = (body as Record<string, unknown>).expectedUpdatedAt as string | undefined;
    // cascadeConfirmed: uživatel velkou kaskádu odklepl v dialogu (zatím jen měření — CASCADE_CONFIRM_ENFORCED je false).
    const cascadeConfirmed = (body as Record<string, unknown>).cascadeConfirmed === true;

    // Transakci otevírá `withRevision` — zkrácená hlava dostane revizi `kind: "UPDATE"`,
    // nově vzniklý ocas `kind: "CREATE"` a chain pushem odsunutí sousedé `kind: "UPDATE"`,
    // všichni pod jedním `groupId`. Rozdělení je tak v historii jeden krok, ne dva
    // nesouvisející zápisy. UVNITŘ těla se nesmí sáhnout na modulový `prisma` ani pro
    // čtení (viz docblock withRevision).
    const { result: { head, tail, shifted, headBefore } } = await withRevision(
      { action: "SPLIT", label: "Rozdělení bloku", user: { id: session.id, username: session.username } },
      async (tx) => {
      // 1. In-tx re-read bloku (čerstvý stav pod row-lockem update níže).
      const block = await tx.block.findUnique({ where: { id } });
      if (!block) throw new AppError("NOT_FOUND", "Blok nenalezen.");

      // 1b. Rezervace je nedělitelná (rozhodnutí #7, finální review etapy 9, nález C1):
      // tisková rezervace by po splitu držela plné printMinutes při zkráceném spanu hlavy
      // a re-expanze by jí zdvojila kapacitu. UDRZBA split nikdy negeneroval (klient),
      // guard je defenzivní parita se stejným zdůvodněním.
      if (block.type !== "ZAKAZKA") throw new AppError("VALIDATION_ERROR", "Rozdělit lze jen blok typu zakázka.");

      // 2. Optimistic lock — blok se nezměnil od načtení klientem (jako PUT/batch).
      if (expectedUpdatedAt) {
        const expected = new Date(expectedUpdatedAt);
        if (isNaN(expected.getTime())) throw new AppError("VALIDATION_ERROR", "expectedUpdatedAt není platný timestamp.");
        if (block.updatedAt.getTime() !== expected.getTime()) {
          throw new AppError("CONFLICT", "Blok byl mezitím změněn — obnov stránku a zkus to znovu.");
        }
      }

      // 3. Guardy: vytištěný blok nelze dělit; splitAt musí ležet uvnitř (na ČERSTVÉM endTime).
      //    (Zamčený blok split trigger klient negeneruje — server guard je defenzivní parita.)
      if (block.printCompletedAt != null) throw new AppError("VALIDATION_ERROR", "Nelze rozdělit vytištěný blok.");
      if (splitAt.getTime() <= block.startTime.getTime() || splitAt.getTime() >= block.endTime.getTime()) {
        throw new AppError("VALIDATION_ERROR", "Bod rozdělení musí ležet uvnitř bloku.");
      }

      // 4. Kalendář + tiskové minuty head/tail (čistá funkce; doménové hlášky místo výjimky).
      const cal = await loadMachineCalendar(tx, block.machine, block.startTime);
      const pm = computeSplitPrintMinutes({
        type: block.type,
        scheduleBypassed: block.scheduleBypassed,
        machine: block.machine,
        startTime: block.startTime,
        splitAt,
        totalPrintMinutes: block.printMinutes,
        weekShifts: cal.weekShifts,
        companyDayIntervals: cal.companyDays,
      });
      if (!pm.ok) {
        if (pm.reason === "IN_PAUSE") throw new AppError("SCHEDULE_VIOLATION", "Nelze rozdělit uvnitř pauzy — zvol místo v tiskové části.");
        if (pm.reason === "NOT_ALIGNED") throw new AppError("VALIDATION_ERROR", "V tomto místě nelze rozdělit na celé půlhodiny.");
        throw new AppError("VALIDATION_ERROR", "Nelze rozdělit v tomto místě — jedna část by neměla žádný tiskový čas.");
      }

      // 5. Identita skupiny: převzít existující, nebo založit nový SplitGroup řádek.
      const groupId = block.splitGroupId ?? (await tx.splitGroup.create({ data: {} })).id;

      // 6. HLAVA — end autoritativně přes validateAndComputeEnd (NE syrový splitAt).
      // Snapshot hlavy PŘED zkrácením — Ctrl+Z ho potřebuje, aby split šel vzít zpět.
      // Jen pole, která split SKUTEČNĚ mění; `startTime`/`machine` zůstávají.
      const headBefore = {
        id: block.id,
        endTime: block.endTime.toISOString(),
        splitGroupId: block.splitGroupId,          // POZOR: u už rozdělené zakázky NENÍ null
        printMinutes: block.printMinutes,
        scheduleBypassed: block.scheduleBypassed,
        updatedAt: block.updatedAt.toISOString(),
      };
      const schedH = await validateAndComputeEnd(tx, block.machine, block.startTime, pm.headPm, splitAt, block.type, block.scheduleBypassed);
      if (!schedH.ok) throw new AppError("SCHEDULE_VIOLATION", schedH.error);
      const headUpdated = await tx.block.update({
        where: { id },
        data: {
          endTime: schedH.end,
          splitGroupId: groupId,
          ...(block.type === "ZAKAZKA" ? { printMinutes: pm.headPm, scheduleBypassed: schedH.effectivelyBypassed } : {}),
        },
      });

      // 7. TAIL — end přes validateAndComputeEnd; věrná kopie hlavy (stejná zakázka).
      //    Kopírují se VŠECHNA SPLIT_SHARED_FIELDS (blocks/[id]/route.ts:56) + per-blok
      //    produkční pole (materialNote/obalka/vnitrky/tiskoveArchy/serie); jen časy, pm,
      //    splitGroupId a locked se liší. Nový Block sloupec → přidat i sem (tripwire = review).
      //    reservationId/recurrence se NEkopírují (split část není samostatná rezervace/série).
      const schedT = await validateAndComputeEnd(tx, block.machine, splitAt, pm.tailPm, block.endTime, block.type, block.scheduleBypassed);
      if (!schedT.ok) throw new AppError("SCHEDULE_VIOLATION", schedT.error);
      const tailCreated = await tx.block.create({
        data: {
          machine: block.machine,
          startTime: splitAt,
          endTime: schedT.end,
          locked: false,
          splitGroupId: groupId,
          recurrenceType: "NONE",
          ...(block.type === "ZAKAZKA"
            ? { printMinutes: pm.tailPm, scheduleBypassed: schedT.effectivelyBypassed }
            : {}),
          // ── SPLIT_SHARED_FIELDS (propagovaná skupinová pole) ──
          orderNumber: block.orderNumber,
          description: block.description,
          specifikace: block.specifikace,
          deadlineExpedice: block.deadlineExpedice,
          expediceNote: block.expediceNote,
          doprava: block.doprava,
          expeditionPublishedAt: block.expeditionPublishedAt,
          expeditionSortOrder: block.expeditionSortOrder,
          jobPresetId: block.jobPresetId,
          jobPresetLabel: block.jobPresetLabel,
          type: block.type,
          blockVariant: block.blockVariant,
          dataStatusId: block.dataStatusId,
          dataStatusLabel: block.dataStatusLabel,
          dataRequiredDate: block.dataRequiredDate,
          dataOk: block.dataOk,
          materialStatusId: block.materialStatusId,
          materialStatusLabel: block.materialStatusLabel,
          materialRequiredDate: block.materialRequiredDate,
          materialOk: block.materialOk,
          materialInStock: block.materialInStock,
          materialIssued: block.materialIssued,
          materialPartiallyIssued: block.materialPartiallyIssued,
          pantoneRequiredDate: block.pantoneRequiredDate,
          pantoneOk: block.pantoneOk,
          pantoneRequired: block.pantoneRequired,
          pantoneInStock: block.pantoneInStock,
          pantoneIssued: block.pantoneIssued,
          barvyStatusId: block.barvyStatusId,
          barvyStatusLabel: block.barvyStatusLabel,
          lakStatusId: block.lakStatusId,
          lakStatusLabel: block.lakStatusLabel,
          // ── per-blok produkční pole (NEpropagovaná, ale stejná zakázka → kopírovat) ──
          materialNote: block.materialNote,
          materialNoteByUsername: block.materialNoteByUsername,
          obalka: block.obalka,
          vnitrky: block.vnitrky,
          tiskoveArchy: block.tiskoveArchy,
          serie: block.serie,
        },
      });

      // 8. Audit: tail CREATE + AUTO_SHIFT (chain push). Hlava BEZ UPDATE(endTime) řádku
      //    (parita s dneškem — endTime není v AUDITED_FIELDS; UPDATE by znečistil dashboard stability).
      await tx.auditLog.create({
        data: { blockId: tailCreated.id, orderNumber: tailCreated.orderNumber, userId: session.id, username: session.username, action: "CREATE" },
      });

      // 9. Chain push ocasu (jen ZAKAZKA; ne-ZAKAZKA se nepřekládá).
      let shiftedMoves: AppliedMove[] = [];
      if (block.type === "ZAKAZKA") {
        shiftedMoves = await resolveChainPushFromDb(
          tx, block.machine,
          { id: tailCreated.id, startTime: tailCreated.startTime, endTime: tailCreated.endTime },
          new Set<number>(), new Set<number>(),
          { cascadeConfirmed, path: "split" }
        );
        if (shiftedMoves.length > 0) {
          await tx.auditLog.createMany({
            data: shiftedMoves.map((m) => ({
              blockId: m.id,
              orderNumber: m.orderNumber,
              userId: session.id,
              username: session.username,
              action: "AUTO_SHIFT",
              field: "startTime/endTime",
              oldValue: `${m.oldStartTime.toISOString()}–${m.oldEndTime.toISOString()}`,
              newValue: `${m.startTime.toISOString()}–${m.endTime.toISOString()}`,
            })),
          });
        }
      }
      // Finální tvrdá pojistka — VŠECHNY typy: head, tail ani posunutí nesmí skončit překryté
      // (parita POST/PUT; dřív jen ZAKAZKA, split ne-ZAKAZKA bloku pojistku obcházel).
      await assertNoOverlapForBlocks(block.machine, [headUpdated.id, tailCreated.id, ...shiftedMoves.map((m) => m.id)], tx);

      // Zrcadlo Reservation.scheduled* — hlava (nese případný reservationId), ocas i odsunuté (etapa 9, fáze 0).
      // Split je ZAKAZKA-only, ale ZAKAZKA vzniklá překlopením rezervace si reservationId nese dál.
      await syncReservationScheduleForBlocks(tx, [headUpdated.id, tailCreated.id, ...shiftedMoves.map((m) => m.id)]);

      return { head: headUpdated, tail: tailCreated, shifted: shiftedMoves, headBefore };
      // Tělo výše si drží PŮVODNÍ odsazení — viz komentář u PUT bloku.
      // Timeout 15 s / maxWait 5 s má `withRevision` jako výchozí, nepředává se.
      },
    );

    // Refetch head + tail + shifted JEDNÍM findMany s notes include — jediný zdroj pro SSE i
    // response, aby se původce a ostatní okna nerozešli a autorizovaní neztratili poznámky hlavy.
    const shiftedIds = shifted.map((m) => m.id);
    const refetched = await prisma.block.findMany({
      where: { id: { in: [head.id, tail.id, ...shiftedIds] } },
      include: { Reservation: { select: { confirmedAt: true } }, notes: { orderBy: { createdAt: "desc" as const } } },
    });
    const byId = new Map(refetched.map((b) => [b.id, b]));
    const headSer = serializeBlock(byId.get(head.id) ?? head);
    const tailSer = serializeBlock(byId.get(tail.id) ?? tail);
    const shiftedSer = shiftedIds.map((sid) => byId.get(sid)).filter((b): b is NonNullable<typeof b> => b != null).map(serializeBlock);

    // SSE nese notes plné (per-connection strip v /api/events je zahodí rolím bez práva).
    emitSSE("block:updated", { block: headSer, machine: head.machine, sourceUserId: session.id });
    emitSSE("block:created", { block: tailSer, machine: tail.machine, sourceUserId: session.id });
    if (shiftedSer.length > 0) emitSSE("block:batch-updated", { blocks: shiftedSer, sourceUserId: session.id });

    // Přímá odpověď mutujícímu — poznámky strip dle role (endpoint je ADMIN/PLANOVAT-only,
    // oba právo mají; gate pro robustnost/konzistenci s POST/PUT).
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    return NextResponse.json({
      head: stripNotesIfDenied(headSer, canSeeNotes),
      tail: stripNotesIfDenied(tailSer, canSeeNotes),
      shifted: shiftedSer.map((b) => stripNotesIfDenied(b, canSeeNotes)),
      // Snapshot PŘED splitem — klient z něj složí krok historie (Ctrl+Z), viz task S1.
      // `head.machine` = `block.machine` (split stroj nemění), `shifted` = `shiftedMoves`
      // (obojí z uzávěru transakce, mimo dosah zde) — obě jména na výstupu z `withRevision`.
      before: { head: headBefore, shifted: shifted.map((m) => moveToBefore(head.machine, m)) },
    });
  } catch (error: unknown) {
    if (isAppError(error) && error.code === "CASCADE_CONFIRM") {
      return NextResponse.json(cascadeConfirmBody(error), { status: errorStatus(error.code) });
    }
    if (isAppError(error)) return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    logger.error("[POST /api/blocks/[id]/split] neočekávaná chyba", error);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
