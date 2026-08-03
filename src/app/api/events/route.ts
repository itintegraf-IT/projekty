import { getSession } from "@/lib/auth";
import { checkSessionVersion } from "@/lib/sessionVersion";
import { eventBus, type SSEEventType, type SSEPayload } from "@/lib/eventBus";
import { logger } from "@/lib/logger";
import { canAccessBlockNotes, type NoteRole } from "@/lib/blockNotePermissions";

export const dynamic = "force-dynamic";

// ── Connection tracking ────────────────────────────────────────────────────
const connections = new Map<number, Set<ReadableStreamDefaultController>>();
const MAX_PER_USER = 5;
const MAX_TOTAL = 100;
const HEARTBEAT_MS = 15_000;

function getTotalConnections(): number {
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

function addConnection(userId: number, controller: ReadableStreamDefaultController): boolean {
  if (getTotalConnections() >= MAX_TOTAL) return false;
  let userSet = connections.get(userId);
  if (!userSet) {
    userSet = new Set();
    connections.set(userId, userSet);
  }
  if (userSet.size >= MAX_PER_USER) return false;
  userSet.add(controller);
  return true;
}

function removeConnection(userId: number, controller: ReadableStreamDefaultController) {
  const userSet = connections.get(userId);
  if (userSet) {
    userSet.delete(controller);
    if (userSet.size === 0) connections.delete(userId);
  }
}

// ── Event types each role can receive ──────────────────────────────────────
const BLOCK_EVENTS: SSEEventType[] = [
  "block:created", "block:updated", "block:deleted",
  "block:batch-updated", "block:print-completed", "block:expedition-changed",
];

const NOTE_EVENTS: SSEEventType[] = [
  "block:note-created", "block:note-updated", "block:note-deleted",
];

function shouldSendEvent(
  event: SSEEventType,
  payload: SSEPayload,
  session: { id: number; role: string; assignedMachine?: string | null }
): boolean {
  // Never send to the author of the change
  if (payload.sourceUserId === session.id) return false;

  const { role, assignedMachine } = session;

  // Tiskařské poznámky vidí jen ADMIN/PLANOVAT/TISKAR (TISKAR jen na svém stroji)
  if (NOTE_EVENTS.includes(event)) {
    if (role === "TISKAR") {
      return (payload.machine as string) === assignedMachine;
    }
    return role === "ADMIN" || role === "PLANOVAT";
  }

  if (role === "TISKAR") {
    if (!BLOCK_EVENTS.includes(event)) return false;
    // Batch eventy (block:batch-updated / chain push) nesou `blocks` (pole), ne `block`/`machine` —
    // filtr proto musí koukat do pole, jinak TISKAR nedostane updaty vlastního stroje (fail-closed).
    if (Array.isArray(payload.blocks)) {
      return (payload.blocks as { machine?: string }[]).some((b) => b?.machine === assignedMachine);
    }
    const machine = (payload.machine as string) ?? (payload.block as { machine?: string })?.machine;
    return machine === assignedMachine;
  }

  if (role === "OBCHODNIK") {
    return event === "reservation:updated";
  }

  if (role === "VIEWER") {
    return BLOCK_EVENTS.includes(event) || event === "schedule:changed";
  }

  // ADMIN, PLANOVAT, DTP, MTZ — everything
  return true;
}

// ── SSE formatter ──────────────────────────────────────────────────────────
const encoder = new TextEncoder();

function formatSSE(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Tiskařské poznámky (`notes`) smí vidět jen ADMIN/PLANOVAT/TISKAR. Block SSE payloady
 * (block:created/updated/batch-updated) ale nesou notes všem připojeným rolím. Pro příjemce
 * bez práva vrátíme MĚLKOU kopii payloadu, kde je v `block`/`blocks` pole `notes` vyprázdněno.
 *
 * NEMUTUJE sdílený payload objekt (ten je jeden pro všechny connections) — kopíruje jen dotčené
 * úrovně. Když příjemce právo má nebo payload žádné bloky nenese, vrací původní objekt.
 */
function stripNotesFromPayload(payload: SSEPayload): SSEPayload {
  const hasSingle = payload.block && typeof payload.block === "object";
  const hasArray = Array.isArray(payload.blocks);
  if (!hasSingle && !hasArray) return payload;

  const next: SSEPayload = { ...payload };
  if (hasSingle) {
    next.block = { ...(payload.block as Record<string, unknown>), notes: [] };
  }
  if (hasArray) {
    next.blocks = (payload.blocks as Record<string, unknown>[]).map((b) =>
      b && typeof b === "object" ? { ...b, notes: [] } : b
    );
  }
  return next;
}

// ── GET handler ────────────────────────────────────────────────────────────
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Non-null assertion — null was already handled above
  const authedSession = session;

  // We need cleanup accessible from both start() and cancel()
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Connection limit
      if (!addConnection(authedSession.id, controller)) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Too many connections" })}\n\n`));
        controller.close();
        return;
      }

      logger.info("[sse] connected", { userId: authedSession.id, role: authedSession.role, total: getTotalConnections() });

      // Initial comment
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Heartbeat + periodická revalidace session: stream jinak žije hodiny
      // a uživatel se změněnou rolí nebo smazaným účtem by dál dostával
      // eventy staré role, dokud spojení nespadne (review S4).
      // Pojistka proti vrstvení: `checkSessionVersion` plní cache až po doběhnutí
      // dotazu, takže při zpomalené DB (běžící mysqldump, velký report) by každý
      // další tik šel znovu do DB a soutěžil s uživatelskými zápisy.
      let revalidating = false;
      const heartbeatInterval = setInterval(() => {
        if (revalidating) return;
        revalidating = true;
        void (async () => {
          const stillValid = await checkSessionVersion(
            authedSession.id,
            authedSession.tokenVersion ?? 0
          );
          if (!stillValid) {
            logger.info("[sse] session revokována — zavírám stream", { userId: authedSession.id });
            if (cleanup) cleanup();
            try { controller.close(); } catch { /* už zavřený */ }
            return;
          }
          try {
            controller.enqueue(encoder.encode("event: heartbeat\ndata: \n\n"));
          } catch {
            if (cleanup) cleanup();
          }
        })()
          // Bez .catch() by neošetřená rejection (např. z cleanup() nad rozpadlou
          // mapou spojení) shodila celý Node proces a s ním plán u všech strojů.
          .catch((err) => logger.error("[sse] heartbeat selhal", err))
          .finally(() => { revalidating = false; });
      }, HEARTBEAT_MS);

      // Event listener
      const ALL_EVENTS: SSEEventType[] = [
        "block:created", "block:updated", "block:deleted",
        "block:batch-updated", "block:print-completed", "block:expedition-changed",
        "block:note-created", "block:note-updated", "block:note-deleted",
        "reservation:updated", "schedule:changed",
      ];

      // Poznámky vidí jen ADMIN/PLANOVAT/TISKAR — spočítáno jednou per connection.
      const canSeeNotes = canAccessBlockNotes(authedSession.role as NoteRole);

      function onEvent(event: SSEEventType, payload: SSEPayload) {
        if (!shouldSendEvent(event, payload, authedSession)) return;
        // Block payloady (created/updated/batch-updated) nesou serializované bloky včetně notes;
        // pro příjemce bez práva je zestripovat (kopie, sdílený payload se nemutuje).
        const outgoing = canSeeNotes ? payload : stripNotesFromPayload(payload);
        try {
          controller.enqueue(formatSSE(event, outgoing));
        } catch {
          if (cleanup) cleanup();
        }
      }

      // Register listeners
      const listeners = ALL_EVENTS.map((evt) => {
        const handler = (payload: SSEPayload) => onEvent(evt, payload);
        eventBus.on(evt, handler);
        return { evt, handler };
      });

      // Cleanup function
      let cleaned = false;
      cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeatInterval);
        for (const { evt, handler } of listeners) {
          eventBus.off(evt, handler);
        }
        removeConnection(authedSession.id, controller);
        logger.info("[sse] disconnected", { userId: authedSession.id, total: getTotalConnections() });
      };
    },
    cancel() {
      if (cleanup) cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
