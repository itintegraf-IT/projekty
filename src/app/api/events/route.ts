import { getSession } from "@/lib/auth";
import { eventBus, type SSEEventType, type SSEPayload } from "@/lib/eventBus";
import { logger } from "@/lib/logger";

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

function shouldSendEvent(
  event: SSEEventType,
  payload: SSEPayload,
  session: { id: number; role: string; assignedMachine?: string | null }
): boolean {
  // Never send to the author of the change
  if (payload.sourceUserId === session.id) return false;

  const { role, assignedMachine } = session;

  if (role === "TISKAR") {
    if (!BLOCK_EVENTS.includes(event)) return false;
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

      // Heartbeat
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("event: heartbeat\ndata: \n\n"));
        } catch {
          if (cleanup) cleanup();
        }
      }, HEARTBEAT_MS);

      // Event listener
      const ALL_EVENTS: SSEEventType[] = [
        "block:created", "block:updated", "block:deleted",
        "block:batch-updated", "block:print-completed", "block:expedition-changed",
        "reservation:updated", "schedule:changed",
      ];

      function onEvent(event: SSEEventType, payload: SSEPayload) {
        if (!shouldSendEvent(event, payload, authedSession)) return;
        try {
          controller.enqueue(formatSSE(event, payload));
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
