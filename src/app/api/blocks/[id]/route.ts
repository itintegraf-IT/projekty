import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AppError, isAppError } from "@/lib/errors";
import { normalizeBlockVariant } from "@/lib/blockVariants";
import { parseNullableCivilDateForDb, serializeAuditValue, serializeBlock } from "@/lib/blockSerialization";
import { getExpeditionDayKey, getNextExpeditionSortOrder } from "@/lib/expedition";
import { resolvePresetForBlock } from "@/lib/jobPresetServer";
import { validateAndComputeEnd } from "@/lib/scheduleValidationServer";
import { computePrintMinutes } from "@/lib/printTime";
import { loadMachineCalendar } from "@/lib/printTime.server";
import { checkBlockOverlap, assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { resolveChainPushFromDb, type AppliedMove } from "@/lib/overlapResolver.server";
import { emitSSE } from "@/lib/eventBus";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    const block = await prisma.block.findUnique({
      where: { id },
      include: {
        Reservation: { select: { confirmedAt: true } },
        ...(canSeeNotes ? { notes: { orderBy: { createdAt: "desc" as const } } } : {}),
      },
    });
    if (!block) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    // TISKAR smí číst jen bloky svého stroje
    if (session.role === "TISKAR" && block.machine !== session.assignedMachine) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(serializeBlock(block));
  } catch (error) {
    logger.error(`[GET /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

// POZOR — NIKDY sem nepřidávat startTime/endTime/machine: split sourozenci se aktualizují
// přes updateMany, který NEprochází finální pojistkou assertNoOverlapForBlocks (ta kontroluje
// jen editovaný blok + chain-push posuny). Časové pole tady by otevřelo nehlídaný překryv.
const SPLIT_SHARED_FIELDS = [
  "orderNumber", "description", "specifikace", "deadlineExpedice",
  "expediceNote", "doprava",
  "expeditionPublishedAt", "expeditionSortOrder",
  "jobPresetId", "jobPresetLabel",
  "type", "blockVariant",
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk", "materialInStock", "materialIssued",
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired",
  "barvyStatusId", "barvyStatusLabel", "lakStatusId", "lakStatusLabel",
] as const;
type SplitSharedField = typeof SPLIT_SHARED_FIELDS[number];

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Role-based field filter
    let allowed: Record<string, unknown>;
    if (["ADMIN", "PLANOVAT"].includes(session.role)) {
      allowed = body;
    } else if (session.role === "DTP") {
      allowed = {
        dataStatusId: body.dataStatusId,
        dataStatusLabel: body.dataStatusLabel,
        dataOk: body.dataOk,
      };
    } else if (session.role === "MTZ") {
      allowed = {
        materialStatusId: body.materialStatusId,
        materialStatusLabel: body.materialStatusLabel,
        materialRequiredDate: body.materialRequiredDate,
        materialOk: body.materialOk,
        materialNote: body.materialNote,
        pantoneRequiredDate: body.pantoneRequiredDate,
        pantoneOk: body.pantoneOk,
        pantoneRequired: body.pantoneRequired,
        materialInStock: body.materialInStock,
        materialIssued: body.materialIssued,
      };
    } else {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // bypassScheduleValidation přeskakuje jen working hours validaci, NE firemní odstávky (companyDays).
    const bypassScheduleValidation = (body as Record<string, unknown>).bypassScheduleValidation === true;
    // bypassOverlapCheck přeskakuje overlap check — používá se POUZE při drag & drop / resize,
    // kde autoResolveOverlap ihned po uložení vyřeší překryvy přes batch endpoint.
    const bypassOverlapCheck = (body as Record<string, unknown>).bypassOverlapCheck === true;
    // resolveChain: server po uložení bloku sám odsune navazující bloky (chain push) v téže transakci.
    const resolveChain = (body as Record<string, unknown>).resolveChain === true;
    // Explicitně smazat příznaky z allowed — nesmí jít do prisma.block.update
    delete (allowed as Record<string, unknown>).bypassScheduleValidation;
    delete (allowed as Record<string, unknown>).bypassOverlapCheck;
    delete (allowed as Record<string, unknown>).resolveChain;
    delete (allowed as Record<string, unknown>).expeditionPublishedAt;
    delete (allowed as Record<string, unknown>).expeditionSortOrder;
    delete (allowed as Record<string, unknown>).expectedUpdatedAt;
    // B2: splitGroupId se přes PUT NEZAPISUJE — identitu skupiny mění výhradně /split endpoint.
    // (Stará karta prohlížeče by jinak poslala self-link PUT {splitGroupId: block.id}, který po
    // přebodování FK na SplitGroup spadne na FK violation. Ignorováním dostane čistý no-op.)
    delete (allowed as Record<string, unknown>).splitGroupId;
    // Remove undefined values
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

    // ── DATA chip auto-derivace ──
    // Pravidlo 1 a 2 se vyhodnocují uvnitř transakce (potřebují oldBlock pro porovnání).
    // Viz komentář "DATA chip auto-derivace" níže.

    // Server-side validace pracovní doby:
    // Validujeme pokud se mění startTime/endTime/machine NEBO pokud se typ mění na ZAKAZKA
    // (blok mohl být mimo provoz jako REZERVACE a přejmenovat se na ZAKAZKA).
    //
    // Sémantika printMinutes (viz docs/superpowers/sdd task-4-brief.md):
    //  1) explicitní allowed.printMinutes → autoritativní
    //  2) resize (mění se JEN endTime, start/machine beze změny) → inverze z nového endu
    //     (bypass blok → prostý elapsed)
    //  3) move (mění se start/machine) NEBO end beze změny → printMinutes ze záznamu;
    //     klientův poslaný endTime se u move IGNORUJE (drag & drop vždy posílá start+end,
    //     naivní end by u bloku s pauzami dal špatnou inverzi — viz Finding A)
    //  4) změna typu na ZAKAZKA → odvodit ze spanu; pryč z ZAKAZKA → printMinutes null, scheduleBypassed false
    //
    // Výpočet samotný běží AŽ uvnitř $transaction (derivováno z in-tx `oldBlock`), aby
    // nedošlo k TOCTOU race mezi pre-tx čtením a zápisem (Finding B).
    // printMinutes se čte z role-filtrovaného `allowed`, NE ze syrového body — jinak by DTP/MTZ
    // (bez printMinutes v allowlistu) mohl přiložením printMinutes k povolenému fieldu vyvolat
    // přepočet endu cizího bloku. ADMIN/PLANOVAT mají allowed = body → printMinutes průchozí.
    const allowedPrintMinutes = (allowed as Record<string, unknown>).printMinutes;
    const timingChanged = allowed.startTime !== undefined || allowed.endTime !== undefined || allowed.machine !== undefined;
    const typeChangesToZakazka = allowed.type === "ZAKAZKA";
    const needsScheduleComputation =
      timingChanged || typeChangesToZakazka || allowed.type !== undefined || typeof allowedPrintMinutes === "number";

    const AUDITED_FIELDS = [
      "dataStatusLabel", "dataRequiredDate", "dataOk",
      "materialStatusLabel", "materialRequiredDate", "materialOk", "materialNote",
      "pantoneRequiredDate", "pantoneOk", "pantoneRequired", "materialInStock", "materialIssued",
      "deadlineExpedice",
      "expediceNote", "doprava",
      "blockVariant",
      "jobPresetLabel",
      "obalka", "vnitrky", "tiskoveArchy", "serie",
    ] as const;
    type AuditedField = typeof AUDITED_FIELDS[number];

    const { block, shifted, propagatedGroupId } = await prisma.$transaction(async (tx) => {
      const oldBlock = await tx.block.findUnique({ where: { id } });
      if (!oldBlock) {
        throw new AppError("NOT_FOUND", "Blok nenalezen");
      }

      // Optimistic locking — ověřit, že blok se nezměnil od načtení klientem
      const expectedUpdatedAt = (body as Record<string, unknown>).expectedUpdatedAt as string | undefined;
      if (expectedUpdatedAt) {
        const expected = new Date(expectedUpdatedAt);
        if (isNaN(expected.getTime())) {
          throw new AppError("VALIDATION_ERROR", "expectedUpdatedAt není platný timestamp.");
        }
        if (oldBlock.updatedAt.getTime() !== expected.getTime()) {
          throw new AppError("CONFLICT", "Blok byl mezitím změněn jiným uživatelem.");
        }
      }

      // ── Výpočet computed*/end/printMinutes/scheduleBypassed (uvnitř tx, derivováno z in-tx oldBlock) ──
      // Viz sémantika printMinutes v komentáři nad `needsScheduleComputation` výše.
      let computedEnd: Date | null = null;
      let computedPrintMinutes: number | null = null;
      let computedBypassed: boolean | null = null;

      if (needsScheduleComputation) {
        const checkMachine = (allowed.machine as string | undefined) ?? oldBlock.machine;
        const checkType = (allowed.type as string | undefined) ?? oldBlock.type;
        const checkStart = allowed.startTime ? new Date(allowed.startTime as string) : oldBlock.startTime;
        const requestedEnd = allowed.endTime ? new Date(allowed.endTime as string) : oldBlock.endTime;

        if (checkType !== "ZAKAZKA") {
          // Z ZAKAZKA pryč (nebo ne-ZAKAZKA blok): printMinutes vyčistit, end = požadovaný.
          computedEnd = requestedEnd;
          computedPrintMinutes = null;
          computedBypassed = false;
        } else {
          // Detekce move vs. resize — dnešní drag-move klient posílá VŽDY start i end
          // (end = newStart + starý span). Nelze tedy rozeznat move od resize podle
          // "endTime se změnilo" — to je pravda i u move. Rozhoduje start/machine:
          const startOrMachineChanged =
            (allowed.startTime !== undefined && checkStart.getTime() !== oldBlock.startTime.getTime())
            || (allowed.machine !== undefined && checkMachine !== oldBlock.machine);
          const isResize = !startOrMachineChanged
            && allowed.endTime !== undefined
            && requestedEnd.getTime() !== oldBlock.endTime.getTime();
          // Bypass INPUT do validace: request flag rozhoduje JEN při skutečné změně pozice/délky
          // (move/resize). Pouhá přítomnost endTime v payloadu (BlockEdit posílá end vždy)
          // nesmí bypass blok tiše re-expandovat — jinak se flag ztratí uložením popisu.
          const bypass = (startOrMachineChanged || isResize) ? bypassScheduleValidation : oldBlock.scheduleBypassed;

          let pm: number | null;
          if (typeof allowedPrintMinutes === "number") {
            pm = allowedPrintMinutes;                            // 1) explicitní (z role-filtrovaného allowed)
          } else if (isResize) {
            // 2) resize — inverze z nového endu (start/machine beze změny)
            if (bypass) {
              pm = Math.round((requestedEnd.getTime() - checkStart.getTime()) / 60000);
            } else {
              const cal = await loadMachineCalendar(tx, checkMachine, checkStart);
              pm = computePrintMinutes(checkMachine, checkStart, requestedEnd, cal.weekShifts, cal.companyDays);
            }
          } else if (oldBlock.printMinutes != null && oldBlock.type === "ZAKAZKA") {
            // 3) move (start/machine změna) nebo end beze změny — printMinutes ze záznamu.
            // Klientův poslaný endTime se zde záměrně ignoruje.
            pm = oldBlock.printMinutes;
          } else {
            // fallback (legacy blok bez printMinutes / změna typu na ZAKAZKA): odvodit ze spanu
            pm = Math.round((oldBlock.endTime.getTime() - oldBlock.startTime.getTime()) / 60000);
          }

          const sched = await validateAndComputeEnd(tx, checkMachine, checkStart, pm, requestedEnd, "ZAKAZKA", bypass);
          if (!sched.ok) {
            throw new AppError("SCHEDULE_VIOLATION", sched.error);
          }
          computedEnd = sched.end;
          computedPrintMinutes = pm;
          // Uložit SPOČÍTANOU pravdu, ne echo bypass flagu — bypass request na místě,
          // které kalendáři sedí, blok trvale neoznačí (effectivelyBypassed = false).
          computedBypassed = sched.effectivelyBypassed;
        }
      }

      // ── DATA chip auto-derivace (potřebuje oldBlock) ──
      // Pravidlo 1: Změna dataRequiredDate → vymazat chip + dataOk=false
      //   Spouští se JEN pokud se datum skutečně změnilo (ne jen proto, že ho klient poslal znovu).
      if (allowed.dataRequiredDate !== undefined) {
        const oldDateKey = oldBlock.dataRequiredDate?.toISOString().slice(0, 10) ?? null;
        const newRaw = allowed.dataRequiredDate as string | null;
        const newDateKey = newRaw ? new Date(newRaw + "T00:00:00.000Z").toISOString().slice(0, 10) : null;
        if (newDateKey !== oldDateKey) {
          allowed.dataStatusId = null;
          allowed.dataStatusLabel = null;
          allowed.dataOk = false;
        }
      }
      // Pravidlo 2: Změna chipu → auto-derivovat dataOk
      if (allowed.dataStatusId !== undefined && !(allowed.dataRequiredDate !== undefined && allowed.dataStatusId === null)) {
        allowed.dataOk = allowed.dataStatusId !== null;
      }

      // Časný overlap check — přeskočit při bypassOverlapCheck NEBO resolveChain
      // (u resolveChain smí anchor přistát na obsazené místo, chain push to vyřeší
      // a finální assertNoOverlapForBlocks na konci transakce ověří výsledek).
      if (!bypassOverlapCheck && !resolveChain) {
        const checkMachine = (allowed.machine as string | undefined) ?? oldBlock.machine;
        const checkStart = allowed.startTime ? new Date(allowed.startTime as string) : oldBlock.startTime;
        const checkEnd = computedEnd ?? oldBlock.endTime;
        if (
          checkStart.getTime() !== oldBlock.startTime.getTime() ||
          checkEnd.getTime() !== oldBlock.endTime.getTime() ||
          checkMachine !== oldBlock.machine
        ) {
          await checkBlockOverlap(checkMachine, checkStart, checkEnd, id, tx);
        }
      }

      // Normalizace blockVariant — platí na výsledný type, ne jen na vstup
      // Fallback na existující hodnotu z DB pokud blockVariant není v requestu (předchází tiché přepísání na STANDARD)
      const resultingType = (allowed.type as string | undefined) ?? oldBlock?.type ?? "ZAKAZKA";
      const blockVariant = normalizeBlockVariant(
        (allowed.blockVariant as string | undefined) ?? oldBlock?.blockVariant,
        resultingType
      );
      const nextDeadlineExpedice =
        allowed.deadlineExpedice !== undefined
          ? parseNullableCivilDateForDb(allowed.deadlineExpedice)
          : oldBlock.deadlineExpedice;
      const oldExpeditionDayKey = getExpeditionDayKey(oldBlock.deadlineExpedice);
      const nextExpeditionDayKey = getExpeditionDayKey(nextDeadlineExpedice);
      const mustClearExpeditionState =
        resultingType !== "ZAKAZKA" || nextDeadlineExpedice == null;
      let nextExpeditionPublishedAt = oldBlock.expeditionPublishedAt;
      let nextExpeditionSortOrder = oldBlock.expeditionSortOrder;

      if (mustClearExpeditionState) {
        nextExpeditionPublishedAt = null;
        nextExpeditionSortOrder = null;
      } else if (oldBlock.expeditionPublishedAt != null) {
        if (oldExpeditionDayKey !== nextExpeditionDayKey || oldBlock.expeditionSortOrder == null) {
          nextExpeditionSortOrder = await getNextExpeditionSortOrder(tx, nextDeadlineExpedice);
        }
      } else {
        nextExpeditionSortOrder = null;
      }

      const presetExplicitlyChanged = allowed.jobPresetId !== undefined;
      let presetUpdate:
        | { jobPresetId: number | null; jobPresetLabel: string | null }
        | null = null;

      if (resultingType === "UDRZBA") {
        presetUpdate = { jobPresetId: null, jobPresetLabel: null };
      } else if (presetExplicitlyChanged) {
        const presetResult = await resolvePresetForBlock(allowed.jobPresetId, resultingType);
        if ("error" in presetResult) {
          throw new AppError("PRESET_INVALID", presetResult.error);
        }
        presetUpdate = presetResult;
      } else if (allowed.type !== undefined && oldBlock.jobPresetId) {
        const existingPreset = await prisma.jobPreset.findUnique({
          where: { id: oldBlock.jobPresetId },
          select: { appliesToZakazka: true, appliesToRezervace: true },
        });
        if (existingPreset) {
          if (resultingType === "ZAKAZKA" && !existingPreset.appliesToZakazka) {
            throw new AppError("PRESET_INVALID", "Vybraný preset není povolen pro zakázku.");
          }
          if (resultingType === "REZERVACE" && !existingPreset.appliesToRezervace) {
            throw new AppError("PRESET_INVALID", "Vybraný preset není povolen pro rezervaci.");
          }
        }
      }

      // Pokud se type mění z ZAKAZKA na jiný typ, vyčistit printCompleted jako konzistenční cleanup
      const typeChangingAwayFromZakazka =
        oldBlock?.type === "ZAKAZKA" &&
        (allowed.type as string | undefined) !== undefined &&
        (allowed.type as string | undefined) !== "ZAKAZKA";

      const updated = await tx.block.update({
        where: { id },
        data: {
          ...(allowed.orderNumber !== undefined && { orderNumber: String(allowed.orderNumber) }),
          ...(allowed.machine !== undefined && { machine: allowed.machine as string }),
          ...(allowed.startTime !== undefined && { startTime: new Date(allowed.startTime as string) }),
          ...(computedEnd !== null && { endTime: computedEnd }),
          ...(computedEnd !== null && { printMinutes: computedPrintMinutes }),
          ...(computedBypassed !== null && { scheduleBypassed: computedBypassed }),
          ...(allowed.type !== undefined && { type: allowed.type as string }),
          // Pokud se type mění pryč od ZAKAZKA, vyčistit printCompleted
          ...(typeChangingAwayFromZakazka && {
            printCompletedAt: null,
            printCompletedByUserId: null,
            printCompletedByUsername: null,
          }),
          // Aplikovat blockVariant pokud byl explicitně zadán, nebo pokud se mění type (invariant: non-ZAKAZKA → STANDARD)
          ...((allowed.blockVariant !== undefined || allowed.type !== undefined) && { blockVariant }),
          ...(presetUpdate && {
            jobPresetId: presetUpdate.jobPresetId,
            jobPresetLabel: presetUpdate.jobPresetLabel,
          }),
          ...(allowed.description !== undefined && { description: allowed.description as string }),
          ...(allowed.locked !== undefined && { locked: allowed.locked as boolean }),
          ...(allowed.deadlineExpedice !== undefined && {
            deadlineExpedice: nextDeadlineExpedice,
          }),
          ...(allowed.expediceNote !== undefined && {
            expediceNote: normalizeNullableText(allowed.expediceNote),
          }),
          ...(allowed.doprava !== undefined && {
            doprava: normalizeNullableText(allowed.doprava),
          }),
          ...(!isSameNullableDate(oldBlock.expeditionPublishedAt, nextExpeditionPublishedAt) && {
            expeditionPublishedAt: nextExpeditionPublishedAt,
          }),
          ...((oldBlock.expeditionSortOrder ?? null) !== (nextExpeditionSortOrder ?? null) && {
            expeditionSortOrder: nextExpeditionSortOrder,
          }),
          // DATA
          ...(allowed.dataStatusId !== undefined && { dataStatusId: allowed.dataStatusId as number }),
          ...(allowed.dataStatusLabel !== undefined && { dataStatusLabel: allowed.dataStatusLabel as string }),
          ...(allowed.dataRequiredDate !== undefined && {
            dataRequiredDate: parseNullableCivilDateForDb(allowed.dataRequiredDate),
          }),
          ...(allowed.dataOk !== undefined && { dataOk: allowed.dataOk as boolean }),
          // MATERIÁL
          ...(allowed.materialStatusId !== undefined && { materialStatusId: allowed.materialStatusId as number }),
          ...(allowed.materialStatusLabel !== undefined && { materialStatusLabel: allowed.materialStatusLabel as string }),
          ...(allowed.materialRequiredDate !== undefined && {
            materialRequiredDate: parseNullableCivilDateForDb(allowed.materialRequiredDate),
          }),
          ...(allowed.materialOk !== undefined && { materialOk: allowed.materialOk as boolean }),
          ...(allowed.materialNote !== undefined && {
            materialNote: allowed.materialNote as string | null,
            materialNoteByUsername: allowed.materialNote ? session.username : null,
          }),
          // PANTONE
          ...(allowed.pantoneRequiredDate !== undefined && {
            pantoneRequiredDate: parseNullableCivilDateForDb(allowed.pantoneRequiredDate),
          }),
          ...(allowed.pantoneOk !== undefined && { pantoneOk: allowed.pantoneOk as boolean }),
          ...(allowed.pantoneRequired !== undefined && { pantoneRequired: allowed.pantoneRequired as boolean }),
          ...(allowed.pantoneRequired === false && {
            pantoneRequiredDate: null,
            pantoneOk: false,
          }),
          // MATERIAL IN STOCK (pokud materialInStock=true, vynulovat materialRequiredDate)
          ...(allowed.materialInStock !== undefined && { materialInStock: allowed.materialInStock as boolean }),
          ...(allowed.materialInStock === true && { materialRequiredDate: null }),
          // MATERIAL ISSUED (pokud materialIssued=true, vynulovat materialRequiredDate)
          ...(allowed.materialIssued !== undefined && { materialIssued: allowed.materialIssued as boolean }),
          ...(allowed.materialIssued === true && { materialRequiredDate: null }),
          // BARVY
          ...(allowed.barvyStatusId !== undefined && { barvyStatusId: allowed.barvyStatusId as number }),
          ...(allowed.barvyStatusLabel !== undefined && { barvyStatusLabel: allowed.barvyStatusLabel as string }),
          // LAK
          ...(allowed.lakStatusId !== undefined && { lakStatusId: allowed.lakStatusId as number }),
          ...(allowed.lakStatusLabel !== undefined && { lakStatusLabel: allowed.lakStatusLabel as string }),
          // SPECIFIKACE
          ...(allowed.specifikace !== undefined && { specifikace: allowed.specifikace as string }),
          // VÝROBNÍ ŠTÍTKY
          ...(allowed.obalka !== undefined && { obalka: allowed.obalka as boolean }),
          ...(allowed.vnitrky !== undefined && { vnitrky: allowed.vnitrky as boolean }),
          ...(allowed.tiskoveArchy !== undefined && { tiskoveArchy: allowed.tiskoveArchy as string | null }),
          ...(allowed.serie !== undefined && { serie: allowed.serie as string | null }),
          // OPAKOVÁNÍ
          ...(allowed.recurrenceType !== undefined && { recurrenceType: allowed.recurrenceType as string }),
          // SPLIT SKUPINA se přes PUT nezapisuje (viz `delete allowed.splitGroupId` výše) —
          // identitu skupiny mění výhradně atomický /split endpoint (B2).
        },
      });

      if (oldBlock) {
        const changes: {
          blockId: number;
          orderNumber: string | null;
          userId: number;
          username: string;
          action: string;
          field?: string;
          oldValue?: string;
          newValue?: string;
        }[] = AUDITED_FIELDS
          .filter((field) => serializeAuditValue(field, oldBlock[field as AuditedField]) !== serializeAuditValue(field, updated[field as AuditedField]))
          .map((field) => ({
            blockId: id,
            orderNumber: oldBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "UPDATE",
            field,
            oldValue: serializeAuditValue(field, oldBlock[field as AuditedField]),
            newValue: serializeAuditValue(field, updated[field as AuditedField]),
          }));

        // Pokud auto-unpublish (mustClearExpeditionState), přidat EXPEDITION_UNPUBLISH záznam
        if (mustClearExpeditionState && oldBlock.expeditionPublishedAt != null) {
          changes.push({
            blockId: id,
            orderNumber: oldBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "EXPEDITION_UNPUBLISH",
          });
        }

        if (changes.length > 0) {
          await tx.auditLog.createMany({ data: changes });
        }
      }

      // Propagace shared fields do split skupiny
      let propagatedGroupId: number | null = null;
      const groupId = updated.splitGroupId;
      if (groupId != null) {
        const sharedUpdate: Record<string, unknown> = {};
        for (const field of SPLIT_SHARED_FIELDS) {
          if ((allowed as Record<string, unknown>)[field] !== undefined) {
            sharedUpdate[field] = (updated as Record<string, unknown>)[field];
          }
        }
        if (presetExplicitlyChanged || resultingType === "UDRZBA") {
          sharedUpdate.jobPresetId = updated.jobPresetId;
          sharedUpdate.jobPresetLabel = updated.jobPresetLabel;
        }
        if (!isSameNullableDate(oldBlock.expeditionPublishedAt, updated.expeditionPublishedAt)) {
          sharedUpdate.expeditionPublishedAt = updated.expeditionPublishedAt;
        }
        if ((oldBlock.expeditionSortOrder ?? null) !== (updated.expeditionSortOrder ?? null)) {
          sharedUpdate.expeditionSortOrder = updated.expeditionSortOrder;
        }
        if (Object.keys(sharedUpdate).length > 0) {
          // Pokud se type mění na non-ZAKAZKA, normalizovat blockVariant na STANDARD
          if (sharedUpdate.type && sharedUpdate.type !== "ZAKAZKA") {
            sharedUpdate.blockVariant = "STANDARD";
          }
          // B2: groupId = updated.splitGroupId (odkaz na SplitGroup.id). Všichni členové
          // skupiny nesou stejný splitGroupId, takže prostý filtr chytí sourozence bez
          // OR přes id — Block.id a SplitGroup.id jsou nezávislé id-prostory.
          await tx.block.updateMany({
            where: { splitGroupId: groupId, id: { not: id } },
            data: sharedUpdate,
          });
          // Sourozenci dostali nový updatedAt → po tx je refetchnout, broadcastnout a vrátit
          // v odpovědi (jinak klienti drží stale updatedAt a další split sourozence spadne na 409).
          propagatedGroupId = groupId;
        }
      }

      // ── Chain push (jen ZAKAZKA) + tvrdá pojistka (všechny typy) ──
      let shiftedMoves: AppliedMove[] = [];
      // Net běží při změně pozice/času/stroje NEBO změně typu jakýmkoliv směrem (spec R1):
      // ZAKAZKA↔ne-ZAKAZKA na legacy-kolidujícím místě jinak net přeskočí.
      const positionOrTypeChanged = timingChanged || typeChangesToZakazka || typeChangingAwayFromZakazka;
      if (positionOrTypeChanged) {
        if (resultingType === "ZAKAZKA" && resolveChain) {
          shiftedMoves = await resolveChainPushFromDb(
            tx,
            updated.machine,
            { id: updated.id, startTime: updated.startTime, endTime: updated.endTime }
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
        // Finální pojistka — VŠECHNY typy (i bez resolveChain, i s bypassOverlapCheck).
        await assertNoOverlapForBlocks(updated.machine, [updated.id, ...shiftedMoves.map((m) => m.id)], tx);
      }

      return { block: updated, shifted: shiftedMoves, propagatedGroupId };
    }, { timeout: 15000, maxWait: 5000 });

    // Refetch VŽDY s notes include — SSE broadcast nese poznámky a per-connection strip v
    // /api/events je zahodí rolím bez práva (D2b). Do PŘÍMÉ odpovědi mutujícímu se ale poznámky
    // vloží jen když na ně má právo: PUT smí volat i DTP/MTZ (editace DATA/MATERIÁL polí), ti
    // tiskařské poznámky vidět nemají (jejich lokální bloky je stejně nemají — merge je konzistentní).
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    const blockWithRes = await prisma.block.findUnique({
      where: { id: block.id },
      include: {
        Reservation: { select: { confirmedAt: true } },
        notes: { orderBy: { createdAt: "desc" as const } },
      },
    }) ?? block;

    emitSSE("block:updated", { block: serializeBlock(blockWithRes), machine: block.machine, sourceUserId: session.id });

    // Posunuté (chain push) bloky — refetch, poslat klientovi v odpovědi i přes SSE ostatním.
    let serializedShifted: ReturnType<typeof serializeBlock>[] = [];
    if (shifted.length > 0) {
      const shiftedBlocks = await prisma.block.findMany({
        where: { id: { in: shifted.map((m) => m.id) } },
        include: {
          Reservation: { select: { confirmedAt: true } },
          notes: { orderBy: { createdAt: "desc" as const } },
        },
      });
      serializedShifted = shiftedBlocks.map(serializeBlock);
      emitSSE("block:batch-updated", { blocks: serializedShifted, sourceUserId: session.id });
    }

    // #9/#12: split sourozenci dostali přes updateMany nový updatedAt, ale samotný updateMany
    // neemituje SSE ani je nevrací → klienti (i originátor) by drželi stale updatedAt a další
    // split sourozence by spadl na falešný 409. Refetch + broadcast ostatním + vrátit originátorovi.
    let serializedSiblings: ReturnType<typeof serializeBlock>[] = [];
    if (propagatedGroupId != null) {
      const siblings = await prisma.block.findMany({
        where: { splitGroupId: propagatedGroupId, id: { not: block.id } },
        include: {
          Reservation: { select: { confirmedAt: true } },
          notes: { orderBy: { createdAt: "desc" as const } },
        },
      });
      // Vyloučit sourozence, kteří už jsou v `shifted` (chain push je refetchuje se stejnými
      // finálními daty) — jinak by šel dvojitý block:batch-updated o témže bloku.
      const shiftedIds = new Set(serializedShifted.map((b) => b.id));
      serializedSiblings = siblings.map(serializeBlock).filter((b) => !shiftedIds.has(b.id));
      if (serializedSiblings.length > 0) {
        emitSSE("block:batch-updated", { blocks: serializedSiblings, sourceUserId: session.id });
      }
    }

    // Odpověď mutujícímu — poznámky zestripovat, pokud na ně jeho role nemá právo (DTP/MTZ).
    const responseBlock = stripNotesIfDenied(serializeBlock(blockWithRes), canSeeNotes);
    const responseShifted = serializedShifted.map((b) => stripNotesIfDenied(b, canSeeNotes));
    const responseSiblings = serializedSiblings.map((b) => stripNotesIfDenied(b, canSeeNotes));
    return NextResponse.json({ ...responseBlock, shifted: responseShifted, siblings: responseSiblings });
  } catch (error: unknown) {
    if (isAppError(error)) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        PRESET_INVALID: 400,
        SCHEDULE_VIOLATION: 422,
        CONFLICT: 409,
        OVERLAP: 409,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 }
      );
    }
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    logger.error(`[PUT /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  // Volitelný důvod zamítnutí rezervace (z body)
  let rejectionReason = "Blok vymazán z plánu";
  try {
    const body = await request.json();
    if (body?.reason && typeof body.reason === "string" && body.reason.trim()) {
      rejectionReason = body.reason.trim();
    }
  } catch {
    // Bez body — použije se výchozí důvod
  }

  try {
    let deletedMachine = "";
    await prisma.$transaction(async (tx) => {
      const blockToDelete = await tx.block.findUnique({
        where: { id },
        select: { orderNumber: true, reservationId: true, machine: true },
      });
      deletedMachine = blockToDelete?.machine ?? "";

      await tx.auditLog.create({
        data: {
          blockId: id,
          orderNumber: blockToDelete?.orderNumber ?? null,
          userId: session.id,
          username: session.username,
          action: "DELETE",
        },
      });

      await tx.block.delete({ where: { id } });

      // Pokud byl blok spojen s rezervací → zamítnout (REJECTED)
      if (blockToDelete?.reservationId) {
        const reservation = await tx.reservation.findUnique({
          where: { id: blockToDelete.reservationId },
          select: { id: true, status: true, code: true, companyName: true, requestedByUserId: true },
        });
        if (reservation && reservation.status !== "REJECTED" && reservation.status !== "WITHDRAWN") {
          await tx.reservation.update({
            where: { id: reservation.id },
            data: {
              status: "REJECTED",
              plannerUserId: session.id,
              plannerUsername: session.username,
              plannerDecisionReason: rejectionReason,
              scheduledBlockId: null,
              scheduledMachine: null,
              scheduledStartTime: null,
              scheduledEndTime: null,
              scheduledAt: null,
            },
          });
          await tx.notification.create({
            data: {
              type: "RESERVATION_REJECTED",
              message: `Rezervace ${reservation.code} (${reservation.companyName}) byla zamítnuta: ${rejectionReason}`,
              reservationId: reservation.id,
              targetUserId: reservation.requestedByUserId,
              createdByUserId: session.id,
              createdByUsername: session.username,
            },
          });
        }
      }
    });
    emitSSE("block:deleted", { blockId: id, machine: deletedMachine, sourceUserId: session.id });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
    }
    logger.error(`[DELETE /api/blocks/${id}]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  );
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isSameNullableDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}
