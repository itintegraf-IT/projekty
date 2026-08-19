import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { parseNullableCivilDateForDb, serializeBlock } from "@/lib/blockSerialization";
import { formatPragueDateTime } from "@/lib/dateUtils";
import { resolvePresetForBlock } from "@/lib/jobPresetServer";
import { validateAndComputeEnd } from "@/lib/scheduleValidationServer";
import { checkBlockOverlap, assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { resolveChainPushFromDb, type AppliedMove } from "@/lib/overlapResolver.server";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { cascadeConfirmBody } from "@/lib/cascadeResponse";
import { findNextFreeSlotFromDb, findNextFreePrintSlotFromDb } from "@/lib/scheduleSlotFinder";
import { emitSSE } from "@/lib/eventBus";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";
import { withRevision } from "@/lib/revision.server";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const machineParam = url.searchParams.get("machine");

    // TISKAR vidí read-only všechny stroje (peek druhého stroje u split zakázek);
    // edity jsou omezeny v /api/blocks/[id] a /api/blocks/[id]/complete podle
    // session.assignedMachine.
    const machineFilter: string | undefined = machineParam ?? undefined;

    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    const blocks = await prisma.block.findMany({
      where: machineFilter ? { machine: machineFilter } : undefined,
      orderBy: { startTime: "asc" },
      include: {
        Reservation: { select: { confirmedAt: true } },
        ...(canSeeNotes ? { notes: { orderBy: { createdAt: "desc" as const } } } : {}),
      },
    });
    return NextResponse.json(blocks.map(serializeBlock));
  } catch (error) {
    logger.error("[GET /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při načítání bloků" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();

    if (!body.orderNumber || !body.machine || !body.startTime || !body.endTime) {
      return NextResponse.json(
        { error: "Chybí povinné pole: orderNumber, machine, startTime, endTime" },
        { status: 400 }
      );
    }

    // Server-side validace pracovní doby (jen pro ZAKAZKA)
    const blockType = body.type ?? "ZAKAZKA";
    const blockVariant = normalizeBlockVariant(body.blockVariant, blockType);
    // bypassScheduleValidation přeskakuje jen working hours validaci, NE firemní odstávky (companyDays).
    const bypassScheduleValidation = body.bypassScheduleValidation === true;
    const bypassOverlapCheck = body.bypassOverlapCheck === true;
    const autoShiftIfBusy = body.autoShiftIfBusy === true;
    // resolveChain: nový blok zůstane na cíli a server odsune navazující (chain push).
    const resolveChain = body.resolveChain === true;
    // cascadeConfirmed: uživatel velkou kaskádu odklepl v dialogu (zatím jen měření — CASCADE_CONFIRM_ENFORCED je false).
    const cascadeConfirmed = body.cascadeConfirmed === true;

    let startTime = new Date(body.startTime);
    let endTime = new Date(body.endTime);
    // Pojistka proti bloku se záporným nebo nulovým trváním: takový interval by prošel
    // skrz VŠECHNY kontroly překryvu (s obráceným pořadím se s ničím neprotne) a v plánu
    // by se vykreslil se zápornou výškou. U ZAKAZKA to zachytí až tiskové hodiny,
    // u REZERVACE/UDRZBA není žádná jiná brzda.
    if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime())) {
      throw new AppError("VALIDATION_ERROR", "Neplatný začátek nebo konec bloku.");
    }
    if (endTime.getTime() <= startTime.getTime()) {
      throw new AppError("VALIDATION_ERROR", "Konec bloku musí být po jeho začátku.");
    }
    const originalStart = new Date(body.startTime);
    const durationMs = endTime.getTime() - startTime.getTime();
    let wasShifted = false;

    // printMinutes: explicitně od klienta, jinak odvozeno z end−start (zpětná kompatibilita —
    // starý klient posílá end se sémantikou end−start = tiskový čas).
    // Fallback z elapsed zůstává trvale — kryje legacy bloky (pm=null) a přímé API klienty;
    // hlavní klient posílá printMinutes explicitně (etapa 4).
    const rawPrintMinutes: number | null =
      typeof body.printMinutes === "number"
        ? body.printMinutes
        : blockType === "ZAKAZKA"
          ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
          : null;

    // scheduleBypassed = SPOČÍTANÁ pravda z validace (effectivelyBypassed), nikdy echo
    // request flagu — bypass request na konformním místě se NEoznačí jako bypass.
    let effectiveBypassed = false;

    const sched = await validateAndComputeEnd(
      prisma, body.machine as string, startTime, rawPrintMinutes, endTime, blockType, bypassScheduleValidation
    );
    if (!sched.ok) {
      // Auto-shift smí maskovat jen PLACEMENT chyby (mimo provoz / odstávka / horizont);
      // INVALID_INPUT (vadné printMinutes / nezarovnaný start) → vždy rovnou 422.
      if (!autoShiftIfBusy || sched.kind === "INVALID_INPUT") {
        return NextResponse.json({ error: sched.error }, { status: 422 });
      }
      // Auto-shift (série z přehledu): start-only snap + expanze — start se snapne na
      // nejbližší aktivní slot a délka se rozloží přes pauzy, žádný teleport za souvislým oknem.
      if (rawPrintMinutes == null) {
        return NextResponse.json({ error: sched.error }, { status: 422 });
      }
      // Pre-transakční větev — klient je výslovně modulový `prisma` (transakce
      // ještě neběží). Uvnitř `withRevision` níž se předává `tx`.
      const slot = await findNextFreePrintSlotFromDb(prisma, body.machine as string, startTime, rawPrintMinutes);
      if (!slot.found) {
        const msg =
          slot.reason === "NO_CAPACITY"
            ? `Auto-shift selhal: v kalendáři stroje ${body.machine} není dost pracovní doby pro ${rawPrintMinutes} min tisku.`
            : `Auto-shift selhal: stroj ${body.machine} obsazen déle než 7 dní od ${originalStart.toISOString()}.`;
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      startTime = slot.startTime;
      endTime = slot.endTime;
      wasShifted = true;
      effectiveBypassed = false; // slot pochází ze souvislé pracovní doby → konformní
      logger.info("[POST /api/blocks] auto-shift applied (pre-tx)", {
        machine: body.machine,
        originalStart: originalStart.toISOString(),
        newStart: startTime.toISOString(),
      });
    } else {
      endTime = sched.end; // autoritativní end ze serveru — klientův end se ignoruje
      effectiveBypassed = sched.effectivelyBypassed;
    }

    // Pokud je přítomno reservationId — ověřit existenci (mimo transakci)
    const reservationId: number | undefined = body.reservationId ? Number(body.reservationId) : undefined;
    let reservationPreview: { id: number; code: string; requestedByUserId: number } | null = null;
    if (reservationId !== undefined) {
      const found = await prisma.reservation.findUnique({
        where: { id: reservationId },
        select: { id: true, code: true, requestedByUserId: true, status: true },
      });
      if (!found) {
        return NextResponse.json({ error: "Rezervace nenalezena" }, { status: 404 });
      }
      if (found.status !== "QUEUE_READY") {
        return NextResponse.json(
          { error: "Rezervace není ve stavu QUEUE_READY — nelze naplánovat" },
          { status: 409 }
        );
      }
      reservationPreview = { id: found.id, code: found.code, requestedByUserId: found.requestedByUserId };
    }

    const finalOrderNumberPreview = reservationPreview ? reservationPreview.code : String(body.orderNumber);
    const finalTypePreview = reservationPreview ? "REZERVACE" : blockType;
    const presetResult = await resolvePresetForBlock(body.jobPresetId, finalTypePreview);
    if ("error" in presetResult) {
      return NextResponse.json({ error: presetResult.error }, { status: 400 });
    }

    // Atomická transakce: block.create + auditLog.create + rezervace SCHEDULED update.
    // Transakci otevírá `withRevision` — podstrčí `tx` s obalenými delegáty `block`
    // a `auditLog`, takže nový blok dostane revizi `kind: "CREATE"`, chain pushem
    // odsunutí sousedé revizi `kind: "UPDATE"` a auditní řádky téže transakce shodné
    // `groupId`. UVNITŘ tohoto těla se nesmí sáhnout na modulový `prisma` ani pro
    // čtení: běželo by mimo transakci, přežilo by její rollback a revizi by obešlo
    // (viz docblock withRevision). Proto i `findNextFree*SlotFromDb` níž dostávají `tx`.
    const { result: { newBlock: block, shiftedMoves } } = await withRevision(
      { action: "CREATE", label: "Nová zakázka", user: { id: session.id, username: session.username } },
      async (tx) => {
      const finalOrderNumber = finalOrderNumberPreview;
      const finalType = finalTypePreview;
      const finalVariant = reservationPreview ? "STANDARD" : blockVariant;
      const finalRecurrence = reservationPreview ? "NONE" : (body.recurrenceType ?? "NONE");

      if (!bypassOverlapCheck && !resolveChain) {
        try {
          await checkBlockOverlap(body.machine, startTime, endTime, null, tx);
        } catch (overlapErr) {
          if (!autoShiftIfBusy || !isAppError(overlapErr) || overlapErr.code !== "OVERLAP") {
            throw overlapErr;
          }
          // Race condition: slot byl mezi pre-check a transakcí obsazen.
          const slot =
            blockType === "ZAKAZKA" && rawPrintMinutes != null
              ? await findNextFreePrintSlotFromDb(tx, body.machine, startTime, rawPrintMinutes)
              : await findNextFreeSlotFromDb(tx, body.machine, startTime, durationMs);
          if (!slot.found) {
            throw new AppError(
              "AUTO_SHIFT_FAILED",
              `Auto-shift selhal: stroj ${body.machine} obsazen déle než 7 dní od ${originalStart.toISOString()}.`
            );
          }
          startTime = slot.startTime;
          endTime = slot.endTime;
          wasShifted = true;
          // Po posunu startu přepočítat autoritativní end znovu přes validateAndComputeEnd
          // (stejná pravidla jako v pre-tx větvi — end nesmí zůstat ze starého slotu).
          const sched2 = await validateAndComputeEnd(
            tx, body.machine, startTime, rawPrintMinutes, endTime, blockType, bypassScheduleValidation
          );
          if (!sched2.ok) {
            throw new AppError("AUTO_SHIFT_FAILED", sched2.error);
          }
          endTime = sched2.end;
          effectiveBypassed = sched2.effectivelyBypassed;
          logger.info("[POST /api/blocks] auto-shift applied (race recovery)", {
            machine: body.machine,
            originalStart: originalStart.toISOString(),
            newStart: startTime.toISOString(),
          });
          // Po posunu už musí overlap projít (ověříme znovu pro jistotu)
          await checkBlockOverlap(body.machine, startTime, endTime, null, tx);
        }
      }

      // REZERVACE: auto-posun SEBE na nejbližší volný slot — nezávisle na resolveChain/
      // autoShiftIfBusy (queue-drop je posílá tak, že existující pre-check větev neběží).
      // Duration-based (ne-ZAKAZKA nemá printMinutes); slot je jen kandidát, finální
      // assertNoOverlapForBlocks (níže) drží souběh.
      // Pozn.: od 31. 7. 2026 platí chain push pro všechny typy, takže s `resolveChain`
      // si rezervace udělá místo odsunutím následníků a uhýbat sama NESMÍ — jinak by
      // si uhnula dřív, než chain push dostane šanci, a drop z fronty by se choval
      // jinak než drag v gridu. Self-shift zůstává jen pro cesty bez resolveChain.
      if (finalType === "REZERVACE" && !bypassOverlapCheck && !resolveChain) {
        const conflict = await tx.block.findFirst({
          where: { machine: body.machine, startTime: { lt: endTime }, endTime: { gt: startTime } },
          select: { id: true },
        });
        if (conflict) {
          const slot = await findNextFreeSlotFromDb(tx, body.machine, startTime, durationMs);
          if (!slot.found) {
            throw new AppError("OVERLAP", "Slot je obsazený a v horizontu není volno — vyber jiné místo.");
          }
          startTime = slot.startTime;
          endTime = slot.endTime;
          wasShifted = true;
          logger.info("[POST /api/blocks] REZERVACE self-shift", { machine: body.machine, newStart: startTime.toISOString() });
        }
      }

      // B2: splitGroupId (undo re-POST) musí odkazovat na existující SplitGroup — jinak by insert
      // spadl na FK constraint. Stará stale-client tail POST self-link (splitGroupId = block.id) tak
      // dostane čistou 422 „Neznámá split skupina" místo generické FK 500 „Chyba při vytváření bloku".
      if (body.splitGroupId != null) {
        const grp = await tx.splitGroup.findUnique({ where: { id: body.splitGroupId as number }, select: { id: true } });
        if (!grp) throw new AppError("VALIDATION_ERROR", "Neznámá split skupina.");
      }

      // SKLADEM nebo VYDÁNO znamená, že pantone je vyřešené — POTŘEBA se vynutí
      // a termín se nemá kam ukládat. Bez toho by vznikl blok s příznakem, ale bez
      // POTŘEBA, kterému by první uložení modalu příznak tiše smazalo.
      //
      // POZOR na rozdíl proti PUT /api/blocks/[id]: u rozporného těla
      // { pantoneInStock: true, pantoneRequired: false } rozhodne každá cesta jinak —
      // POST dá přednost příznaku (SKLADEM přežije, POTŘEBA se zapne), PUT dá přednost
      // výslovnému „pantone není potřeba" a vynuluje všechno. Obojí je záměr: POST
      // zakládá nový blok, kde je příznak jediná skutečná informace, kdežto na PUT je
      // vypnutí POTŘEBY vědomý příkaz uživatele. Z UI ten pár neposílá nikdo.
      const pantoneInStock = body.pantoneInStock ?? false;
      const pantoneIssued = body.pantoneIssued ?? false;
      const pantoneResolved = pantoneInStock || pantoneIssued;

      const newBlock = await tx.block.create({
        data: {
          orderNumber: finalOrderNumber,
          machine: body.machine,
          startTime,
          endTime,
          type: finalType,
          blockVariant: finalVariant,
          description: body.description ?? null,
          locked: body.locked ?? false,
          printMinutes: finalType === "ZAKAZKA" ? rawPrintMinutes : null,
          scheduleBypassed: finalType === "ZAKAZKA" ? effectiveBypassed : false,
          deadlineExpedice: parseNullableCivilDateForDb(body.deadlineExpedice),
          // DATA — auto-derivace: dataOk = true pokud chip nastaven
          dataStatusId: body.dataStatusId ?? null,
          dataStatusLabel: body.dataStatusLabel ?? null,
          dataRequiredDate: parseNullableCivilDateForDb(body.dataRequiredDate),
          dataOk: body.dataStatusId ? true : false,
          // MATERIÁL
          materialStatusId: body.materialStatusId ?? null,
          materialStatusLabel: body.materialStatusLabel ?? null,
          materialRequiredDate: parseNullableCivilDateForDb(body.materialRequiredDate),
          materialOk: body.materialOk ?? false,
          // BARVY
          barvyStatusId: body.barvyStatusId ?? null,
          barvyStatusLabel: body.barvyStatusLabel ?? null,
          // LAK
          lakStatusId: body.lakStatusId ?? null,
          lakStatusLabel: body.lakStatusLabel ?? null,
          // SPECIFIKACE
          specifikace: body.specifikace ?? null,
          // VÝROBNÍ ŠTÍTKY
          obalka: body.obalka ?? false,
          vnitrky: body.vnitrky ?? false,
          tiskoveArchy: body.tiskoveArchy ?? null,
          serie: body.serie ?? null,
          // MATERIÁL POZNÁMKA (jen obsah — autor se nepřenáší, je server-owned)
          materialNote: body.materialNote ?? null,
          // PANTONE + MATERIAL FLAGS
          // Stejný invariant jako v PUT /api/blocks/[id]: je-li SKLADEM nebo VYDÁNO
          // zapnuté, pantone je „vyřešené" — pantoneRequired se vynutí na true a termín
          // se vynuluje. Bez tohohle POST uloží stav, který PUT při první další editaci
          // (BlockEdit.buildPayload posílá pantoneRequired natvrdo z bloku) tiše smaže —
          // uživateli by zmizelo SKLADEM/VYDÁNO při uložení nesouvisející změny.
          pantoneRequiredDate: pantoneResolved ? null : parseNullableCivilDateForDb(body.pantoneRequiredDate),
          pantoneOk: body.pantoneOk ?? false,
          pantoneRequired: pantoneResolved ? true : (body.pantoneRequired ?? false),
          pantoneInStock: pantoneInStock,
          pantoneIssued: pantoneIssued,
          materialInStock: body.materialInStock ?? false,
          materialIssued: body.materialIssued ?? false,
          materialPartiallyIssued: body.materialIssued ? false : (body.materialPartiallyIssued ?? false),
          // OPAKOVÁNÍ
          recurrenceType: finalRecurrence,
          recurrenceParentId: body.recurrenceParentId ?? null,
          // SPLIT SKUPINA
          splitGroupId: body.splitGroupId ?? null,
          // JOB PRESET
          jobPresetId: presetResult.jobPresetId,
          jobPresetLabel: presetResult.jobPresetLabel,
          // REZERVACE
          reservationId: reservationId ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          blockId: newBlock.id,
          orderNumber: newBlock.orderNumber,
          userId: session.id,
          username: session.username,
          action: "CREATE",
        },
      });

      if (wasShifted) {
        await tx.auditLog.create({
          data: {
            blockId: newBlock.id,
            orderNumber: newBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "AUTO_SHIFT",
            field: "startTime",
            oldValue: originalStart.toISOString(),
            newValue: startTime.toISOString(),
          },
        });
      }

      // Pokud jde o rezervaci — atomicky ověřit stav QUEUE_READY a přepnout na SCHEDULED
      if (reservationPreview) {
        const startCZ = formatPragueDateTime(startTime);
        // updateMany s WHERE status=QUEUE_READY — pokud jiný plánovač mezitím rezervaci zabrал,
        // count=0 a transakce se rollbackuje (eliminuje TOCTOU race condition)
        const updateResult = await tx.reservation.updateMany({
          where: { id: reservationPreview.id, status: "QUEUE_READY" },
          data: {
            status: "SCHEDULED",
            scheduledBlockId: newBlock.id,
            scheduledMachine: body.machine,
            scheduledStartTime: startTime,
            scheduledEndTime: endTime,
            scheduledAt: new Date(),
          },
        });
        if (updateResult.count === 0) {
          throw new Error("RESERVATION_NOT_AVAILABLE");
        }
        await tx.notification.create({
          data: {
            type: "RESERVATION_SCHEDULED",
            message: `Rezervace ${reservationPreview.code} byla zařazena na ${body.machine.replace("_", " ")} dne ${startCZ}`,
            reservationId: reservationPreview.id,
            targetUserId: reservationPreview.requestedByUserId,
            createdByUserId: session.id,
            createdByUsername: session.username,
          },
        });
      }

      // Chain push (resolveChain) — nový blok zůstane na cíli, navazující se odsunou.
      // Platí pro všechny typy (rozhodnutí 31. 7. 2026).
      let shiftedMoves: AppliedMove[] = [];
      if (resolveChain) {
        shiftedMoves = await resolveChainPushFromDb(
          tx,
          body.machine,
          { id: newBlock.id, startTime: newBlock.startTime, endTime: newBlock.endTime },
          new Set<number>(),
          new Set<number>(),
          { cascadeConfirmed, path: "POST /api/blocks" }
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
      // Finální pojistka — běží VŽDY a pro VŠECHNY typy (i bez resolveChain / s bypassOverlapCheck):
      // žádný blok (zakázka/rezervace/údržba) nesmí skončit překrytý. Jediná záruka souběhu.
      await assertNoOverlapForBlocks(body.machine, [newBlock.id, ...shiftedMoves.map((m) => m.id)], tx);

      return { newBlock, shiftedMoves };
      // Tělo výše si drží PŮVODNÍ odsazení: přeformátovat 200 řádků kvůli jednomu
      // zanoření navíc by zahltilo diff i recenzi (stejně jako u PUT v Tasku 6).
      // Timeout 15 s / maxWait 5 s má `withRevision` jako výchozí, nepředává se.
      },
    );

    emitSSE("block:created", { block: serializeBlock(block), machine: block.machine, sourceUserId: session.id });

    // Posunuté navazující bloky (chain push) — refetch, poslat klientovi i přes SSE.
    let serializedShifted: ReturnType<typeof serializeBlock>[] = [];
    if (shiftedMoves.length > 0) {
      const shiftedBlocks = await prisma.block.findMany({
        where: { id: { in: shiftedMoves.map((m) => m.id) } },
        include: {
          Reservation: { select: { confirmedAt: true } },
          notes: { orderBy: { createdAt: "desc" as const } },
        },
      });
      serializedShifted = shiftedBlocks.map(serializeBlock);
      emitSSE("block:batch-updated", { blocks: serializedShifted, sourceUserId: session.id });
    }

    // Odpověď mutujícímu — poznámky zestripovat, pokud na ně jeho role nemá právo. POST je dnes
    // ADMIN/PLANOVAT-only (oba právo mají), gate je pro robustnost/konzistenci s ostatními cestami.
    // SSE broadcast výše nese notes plné — per-connection strip v /api/events je zahodí (D2b).
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    const responseBody = {
      ...stripNotesIfDenied(serializeBlock(block), canSeeNotes),
      ...(wasShifted ? { autoShift: { originalStart: originalStart.toISOString() } } : {}),
      shifted: serializedShifted.map((b) => stripNotesIfDenied(b, canSeeNotes)),
    };
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: unknown) {
    if (isAppError(error) && error.code === "CASCADE_CONFIRM") {
      return NextResponse.json(cascadeConfirmBody(error), { status: errorStatus(error.code) });
    }
    if (isAppError(error)) {
      const status409 = error.code === "OVERLAP" || error.code === "AUTO_SHIFT_FAILED";
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: status409 ? 409 : 400 }
      );
    }
    if (error instanceof Error && error.message === "RESERVATION_NOT_AVAILABLE") {
      // `code` je tu nutné: klient rozlišuje tuhle 409 od 409 z overlap guardu,
      // aby uživateli nepodsouval „obnovte stránku" místo skutečného důvodu.
      return NextResponse.json(
        { error: "Rezervace již není dostupná — jiný plánovač ji mezitím přiřadil", code: "RESERVATION_NOT_AVAILABLE" },
        { status: 409 }
      );
    }
    logger.error("[POST /api/blocks]", error);
    return NextResponse.json({ error: "Chyba při vytváření bloku" }, { status: 500 });
  }
}
