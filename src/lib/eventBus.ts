import { EventEmitter } from "events";
import { logger } from "@/lib/logger";

const MAX_LISTENERS = 50;

const globalForEventBus = globalThis as unknown as {
  eventBus: EventEmitter | undefined;
};

export const eventBus =
  globalForEventBus.eventBus ?? new EventEmitter();

eventBus.setMaxListeners(MAX_LISTENERS);

if (process.env.NODE_ENV !== "production") {
  globalForEventBus.eventBus = eventBus;
}

// ── SSE event types ──────────────────────────────────────────────────────

export type SSEEventType =
  | "block:created"
  | "block:updated"
  | "block:deleted"
  | "block:batch-updated"
  | "block:print-completed"
  | "block:expedition-changed"
  | "reservation:updated"
  | "schedule:changed";

export type SSEPayload = {
  sourceUserId: number;
  [key: string]: unknown;
};

// ── Helper for emitting from API routes ──────────────────────────────────

export function emitSSE(event: SSEEventType, payload: SSEPayload) {
  eventBus.emit(event, payload);
  if (process.env.NODE_ENV !== "production") {
    logger.info(`[sse] emit ${event}`, { sourceUserId: payload.sourceUserId });
  }
}
