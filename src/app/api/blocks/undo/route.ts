import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isAppError, errorStatus, AppError } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { emitSSE } from "@/lib/eventBus";
import { sanitizeUndoOps, applyUndoOps, type UndoDirection } from "@/lib/undoApply.server";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";

/**
 * Atomické undo/redo — celý krok historie v JEDNÉ transakci.
 *
 * Existuje proto, že undo se dřív provádělo jako sekvence nezávislých volání
 * (PUT, PUT, batch) bez transakce mezi nimi: cokoliv selhalo uprostřed, zůstalo
 * půl vrácené a další Ctrl+Z už nepomohl. Detaily → docs/superpowers/specs/2026-08-04-atomicke-undo-design.md
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireRole(["ADMIN", "PLANOVAT"]);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new AppError("VALIDATION_ERROR", "Neplatný JSON.");
    const { label, direction } = body as { label?: unknown; direction?: unknown };
    if (typeof label !== "string" || label.length === 0) throw new AppError("VALIDATION_ERROR", "Chybí label.");
    if (direction !== "undo" && direction !== "redo") throw new AppError("VALIDATION_ERROR", "direction musí být undo nebo redo.");

    const ops = sanitizeUndoOps((body as { ops?: unknown }).ops);

    // KRITICKÉ: uvnitř tohoto callbacku smí být JEDINÉ volání — `applyUndoOps`.
    // Ta si jako úplně první dotaz bere `SELECT ... FOR UPDATE`, aby zavřela
    // časové okno mezi kontrolou verze bloku (optimistic lock) a zápisem. Pod
    // MySQL REPEATABLE READ ale transakce zakládá „read view" až při prvním
    // KONZISTENTNÍM čtení. Kdyby cokoliv v téže transakci četlo dřív (další
    // `tx.block.*`, `tx.reservation.*`, cokoliv), snapshot by se zapíchl
    // v dřívějším čase a zamykající čtení by sice drželo zámky, ale vidělo by
    // zastaralá data — ochrana proti souběhu dvou plánovačů by se tiše otevřela
    // zpátky. Nepřidávej sem žádné čtení PŘED `applyUndoOps` a nerozděluj tenhle
    // callback na víc kroků.
    const result = await prisma.$transaction(
      (tx) => applyUndoOps(tx, ops, { id: session.id, username: session.username }, direction as UndoDirection),
      { timeout: 15000, maxWait: 5000 },
    );

    // Log AŽ PO commitu — `applyUndoOps` uvnitř transakce záměrně nic neloguje
    // (log napsaný před commitem by přežil i rollback a tvářil by se jako
    // proběhlé undo, které se ve skutečnosti nestalo). `label` z requestu se
    // nikam do DB nezapisuje, takže tohle je jediné místo, kde vůbec skončí.
    logger.info("[POST /api/blocks/undo] krok historie proveden", {
      direction, label, userId: session.id, username: session.username,
      updated: result.updatedIds.length, created: result.createdIds.length, removed: result.removed.length,
    });

    // Načtení bloků pro odpověď AŽ PO commitu, přes `prisma` (ne `tx`) — transakce
    // je v tuhle chvíli už uzavřená, tohle je běžný samostatný dotaz mimo ni.
    const touched = [...result.updatedIds, ...result.createdIds];
    const rows = touched.length
      ? await prisma.block.findMany({
          where: { id: { in: touched } },
          include: { Reservation: { select: { confirmedAt: true } }, notes: { orderBy: { createdAt: "desc" as const } } },
        })
      : [];
    const serialized = rows.map(serializeBlock);
    // Notes gate JEN na přímou HTTP odpověď mutujícímu — SSE payloady (níže) musí zůstat
    // PLNÉ (s notes), protože `/api/events/route.ts` je filtruje per-connection nezávisle
    // (`stripNotesFromPayload`) podle role KAŽDÉHO příjemce, ne podle role mutujícího.
    // Vzor identický s `batch/route.ts:271-272`: dnešní allowlist (ADMIN/PLANOVAT) má na
    // notes právo vždy, gate je tu pro konzistenci a jako pojistka proti budoucímu
    // rozšíření rolí endpointu (review Tasku 4).
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);

    // Mapování na EXISTUJÍCÍ události — klientské handlery zůstávají beze změny.
    const created = new Set(result.createdIds);
    const updatedSer = serialized.filter((b) => !created.has(b.id));
    if (updatedSer.length > 0) emitSSE("block:batch-updated", { blocks: updatedSer, sourceUserId: session.id });
    for (const b of serialized.filter((x) => created.has(x.id))) {
      emitSSE("block:created", { block: b, machine: b.machine, sourceUserId: session.id });
    }
    // `machine` bereme ze snímku PŘED smazáním (`UndoApplyResult.removed`), NE `null`:
    // SSE gate pro roli TISKAR (`shouldSendEvent` v src/app/api/events/route.ts) filtruje
    // `block:deleted` podle `payload.machine === assignedMachine` a je fail-closed — `null`
    // by znamenal, že se tiskař o smazání bloku vlastního stroje přes undo/redo vůbec nedozví.
    for (const { id, machine } of result.removed) {
      emitSSE("block:deleted", { blockId: id, machine, sourceUserId: session.id });
    }

    return NextResponse.json({
      updated: serialized.map((b) => stripNotesIfDenied(b, canSeeNotes)),
      removed: result.removed.map((r) => r.id),
    });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message, code: err.code }, { status: errorStatus(err.code) });
    logger.error("[POST /api/blocks/undo] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
