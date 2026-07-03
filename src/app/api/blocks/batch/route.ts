import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { serializeBlock } from "@/lib/blockSerialization";
import { validateAndComputeEnd } from "@/lib/scheduleValidationServer";
import { checkBlockOverlap, assertNoOverlapForBlocks, findIntraBatchOverlap } from "@/lib/overlapCheck";
import { resolveChainPushFromDb, type AppliedMove } from "@/lib/overlapResolver.server";
import { AppError, isAppError } from "@/lib/errors";
import { emitSSE } from "@/lib/eventBus";

type BatchUpdate = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  expectedUpdatedAt?: string;
};

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let updates: BatchUpdate[];
  let bypassScheduleValidation = false;
  let bypassOverlapCheck = false;
  let resolveChain = false;
  try {
    const body = await request.json();
    if (!Array.isArray(body.updates) || body.updates.length === 0) {
      return NextResponse.json({ error: "updates musí být neprázdné pole" }, { status: 400 });
    }
    updates = body.updates;
    // bypassScheduleValidation přeskakuje jen working hours validaci, NE firemní odstávky (companyDays).
    bypassScheduleValidation = body.bypassScheduleValidation === true;
    bypassOverlapCheck = body.bypassOverlapCheck === true;
    resolveChain = body.resolveChain === true;
  } catch {
    return NextResponse.json({ error: "Neplatný JSON" }, { status: 400 });
  }

  // Basic time sanity check before hitting DB
  for (const u of updates) {
    const start = new Date(u.startTime);
    const end = new Date(u.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return NextResponse.json({ error: `Neplatné časy pro blok ${u.id}` }, { status: 400 });
    }
  }

  try {
    const { updated: results, shiftedIds } = await prisma.$transaction(async (tx) => {
      // Fetch UVNITŘ transakce — eliminuje TOCTOU gap
      const existingBlocks = await tx.block.findMany({
        where: { id: { in: updates.map((u) => u.id) } },
        select: {
          id: true,
          type: true,
          machine: true,
          startTime: true,
          endTime: true,
          orderNumber: true,
          updatedAt: true,
          printMinutes: true,
          scheduleBypassed: true,
        },
      });

      // Optimistic locking — per-block check
      const staleBlockIds: number[] = [];
      for (const u of updates) {
        if (!u.expectedUpdatedAt) continue;
        const existing = existingBlocks.find((b) => b.id === u.id);
        if (!existing) continue;
        const expected = new Date(u.expectedUpdatedAt);
        if (isNaN(expected.getTime())) continue;
        if (existing.updatedAt.getTime() !== expected.getTime()) {
          staleBlockIds.push(u.id);
        }
      }
      if (staleBlockIds.length > 0) {
        throw new AppError("CONFLICT", `Bloky byly mezitím změněny jiným uživatelem: ${staleBlockIds.join(", ")}`);
      }

      // Validate schedule — only for ZAKAZKA blocks (mirrors single-block PUT behaviour)
      const zakazkaUpdates = updates.filter((u) => {
        const existing = existingBlocks.find((b) => b.id === u.id);
        return existing?.type === "ZAKAZKA";
      });

      // Lasso MOVE: klientův endTime se pro ZAKAZKA ignoruje — printMinutes VŽDY ze záznamu
      // (fallback: odvození ze starého spanu), end počítá server per blok.
      const computedEnds = new Map<number, { end: Date; printMinutes: number; bypassed: boolean }>();
      if (zakazkaUpdates.length > 0) {
        for (const u of zakazkaUpdates) {
          const existing = existingBlocks.find((b) => b.id === u.id)!;
          // Fallback z elapsed zůstává trvale — kryje legacy bloky (pm=null) a přímé API klienty;
          // hlavní klient posílá printMinutes explicitně (etapa 4).
          const pm = existing.printMinutes
            ?? Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60000);
          // Bypass INPUT je sticky OR (lasso UX — přesun skupiny nesmí re-expandovat
          // bypass členy); ULOŽÍ se ale spočítaná pravda (effectivelyBypassed), takže
          // bypass blok přesunutý na konformní místo se z bypass režimu sám vyčistí.
          const bypass = bypassScheduleValidation || existing.scheduleBypassed;
          const sched = await validateAndComputeEnd(
            tx, u.machine, new Date(u.startTime), pm, new Date(u.endTime), "ZAKAZKA", bypass
          );
          if (!sched.ok) throw new AppError("SCHEDULE_VIOLATION", sched.error);
          computedEnds.set(u.id, { end: sched.end, printMinutes: pm, bypassed: sched.effectivelyBypassed });
        }

        // Intra-group pre-check: re-expanze mohla sourozencům změnit délky → překryv
        // UVNITŘ dávky je neřešitelný (chain push sourozence neposouvá) → konkrétní
        // hláška místo generické 409 z finální pojistky.
        const pair = findIntraBatchOverlap(
          zakazkaUpdates.map((u) => ({
            id: u.id,
            orderNumber: existingBlocks.find((b) => b.id === u.id)?.orderNumber ?? null,
            machine: u.machine,
            start: new Date(u.startTime),
            end: computedEnds.get(u.id)!.end,
          }))
        );
        if (pair) {
          throw new AppError(
            "OVERLAP",
            `Bloky #${pair[0].orderNumber ?? pair[0].id} a #${pair[1].orderNumber ?? pair[1].id} se po přepočtu délek překrývají mezi sebou — přesuň je jednotlivě nebo zvol jiné místo.`
          );
        }
      }

      const updated: Awaited<ReturnType<typeof tx.block.update>>[] = [];

      // Zpracovat v obráceném pořadí — při chain push (autoResolveOverlap) poslední blok
      // v chainu se posouvá na volné místo jako první, čímž uvolní prostor pro předchozí.
      // Pro lasso batch (bloky se nepřekrývají navzájem) pořadí nehraje roli.
      const reversed = [...updates].reverse();
      for (const u of reversed) {
        const computed = computedEnds.get(u.id);
        const effectiveEnd = computed?.end ?? new Date(u.endTime);

        // Časný overlap check — přeskočit při bypassOverlapCheck NEBO resolveChain
        // (u resolveChain smí blok přistát na obsazené místo, chain push to vyřeší a finální
        // assertNoOverlapForBlocks ověří výsledek — konzistentně s PUT route).
        if (!bypassOverlapCheck && !resolveChain) {
          await checkBlockOverlap(u.machine, new Date(u.startTime), effectiveEnd, u.id, tx);
        }

        const result = await tx.block.update({
          where: { id: u.id },
          data: {
            startTime: new Date(u.startTime),
            endTime: effectiveEnd,
            machine: u.machine,
            ...(computed && {
              printMinutes: computed.printMinutes,
              scheduleBypassed: computed.bypassed,
            }),
          },
        });
        updated.push(result);
      }

      // Bloky ke kontrole překryvu, per stroj — přesunuté z dávky + případně posunuté chain pushem.
      const checkByMachine = new Map<string, number[]>();
      for (const u of zakazkaUpdates) {
        const arr = checkByMachine.get(u.machine) ?? [];
        arr.push(u.id);
        checkByMachine.set(u.machine, arr);
      }

      // Chain push (resolveChain) — každý přesunutý ZAKAZKA blok odsune navazující;
      // sourozenci z téže dávky (lasso) se neposouvají (excludeIds = movedIds).
      const shiftedMoves: AppliedMove[] = [];
      if (resolveChain && zakazkaUpdates.length > 0) {
        const movedIds = new Set(zakazkaUpdates.map((u) => u.id));
        // Sestupně dle startTime — pozdější blok uvolní místo dřív (kompozičně korektnější
        // chain push při více anchorech v jedné dávce). Finální pojistka je záchrana.
        const anchorsByStartDesc = [...zakazkaUpdates].sort(
          (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );
        for (const u of anchorsByStartDesc) {
          const moves = await resolveChainPushFromDb(
            tx,
            u.machine,
            { id: u.id, startTime: new Date(u.startTime), endTime: computedEnds.get(u.id)?.end ?? new Date(u.endTime) },
            movedIds
          );
          shiftedMoves.push(...moves);
          const arr = checkByMachine.get(u.machine) ?? [];
          arr.push(...moves.map((m) => m.id));
          checkByMachine.set(u.machine, arr);
        }
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

      // Finální pojistka — žádný ZAKAZKA blok (přesunutý ani posunutý) nesmí skončit překrytý.
      // Běží VŽDY (i při bypassOverlapCheck): zachytí překryv v rámci této transakce.
      for (const [machine, ids] of checkByMachine) {
        await assertNoOverlapForBlocks(machine, ids, tx);
      }

      const auditRows: {
        blockId: number;
        orderNumber: string | null;
        userId: number;
        username: string;
        action: string;
        field?: string;
        oldValue?: string;
        newValue?: string;
      }[] = [];

      for (const u of updates) {
        const old = existingBlocks.find((b) => b.id === u.id);
        const updatedBlock = updated.find((b) => b.id === u.id);
        const orderNumber = updatedBlock?.orderNumber ?? old?.orderNumber ?? null;
        const effectiveEnd = computedEnds.get(u.id)?.end ?? new Date(u.endTime);

        auditRows.push({
          blockId: u.id,
          orderNumber,
          userId: session.id,
          username: session.username,
          action: "UPDATE",
          field: "startTime/endTime/machine",
          oldValue: undefined,
          newValue: `${u.machine} ${u.startTime}–${effectiveEnd.toISOString()}`,
        });
      }

      await tx.auditLog.createMany({ data: auditRows });

      return { updated, shiftedIds: shiftedMoves.map((m) => m.id) };
    }, { timeout: 15000, maxWait: 5000 });

    // Refetch s Reservation a notes include — batch smí volat jen ADMIN/PLANOVAT, takže notes se vždy vrací
    const resultsWithRes = await prisma.block.findMany({
      where: { id: { in: [...results.map((r) => r.id), ...shiftedIds] } },
      include: {
        Reservation: { select: { confirmedAt: true } },
        notes: { orderBy: { createdAt: "desc" as const } },
      },
    });

    emitSSE("block:batch-updated", { blocks: resultsWithRes.map(serializeBlock), sourceUserId: session.id });
    return NextResponse.json(resultsWithRes.map(serializeBlock));
  } catch (error: unknown) {
    if (isAppError(error)) {
      const statusMap: Record<string, number> = {
        OVERLAP: 409,
        CONFLICT: 409,
        SCHEDULE_VIOLATION: 422,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 }
      );
    }
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Jeden nebo více bloků nenalezeno" }, { status: 404 });
    }
    logger.error("[POST /api/blocks/batch]", error);
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
