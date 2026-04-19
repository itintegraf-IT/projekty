"use client";

import { useEffect, useRef, useCallback } from "react";

export type SSEEventType =
  | "block:created"
  | "block:updated"
  | "block:deleted"
  | "block:batch-updated"
  | "block:print-completed"
  | "block:expedition-changed"
  | "reservation:updated"
  | "schedule:changed";

export type SSEMessage = {
  type: SSEEventType;
  payload: Record<string, unknown>;
};

type UseSSEOptions = {
  onEvent: (message: SSEMessage) => void;
  onReconnect?: () => void;
  enabled?: boolean;
};

export function useSSE({ onEvent, onReconnect, enabled = true }: UseSSEOptions) {
  const lastHeartbeatRef = useRef<number>(Date.now());
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  onEventRef.current = onEvent;
  onReconnectRef.current = onReconnect;

  const isConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource("/api/events");

    const EVENT_TYPES: SSEEventType[] = [
      "block:created", "block:updated", "block:deleted",
      "block:batch-updated", "block:print-completed", "block:expedition-changed",
      "reservation:updated", "schedule:changed",
    ];

    for (const eventType of EVENT_TYPES) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        lastHeartbeatRef.current = Date.now();
        try {
          const payload = JSON.parse(e.data);
          onEventRef.current({ type: eventType, payload });
        } catch {
          // Nevalidní JSON — ignorovat
        }
      });
    }

    es.addEventListener("heartbeat", () => {
      lastHeartbeatRef.current = Date.now();
    });

    es.addEventListener("session-expired", () => {
      es.close();
      window.location.href = "/";
    });

    es.onopen = () => {
      lastHeartbeatRef.current = Date.now();
      // Pokud to je reconnect (ne první připojení), zavolat onReconnect
      if (isConnectedRef.current) {
        onReconnectRef.current?.();
      }
      isConnectedRef.current = true;
    };

    es.onerror = () => {
      // EventSource se pokusí o auto-reconnect
      // Nemusíme nic dělat — onopen se zavolá po reconnectu
    };

    return () => {
      es.close();
      isConnectedRef.current = false;
    };
  }, [enabled]);

  const getSecondsSinceLastHeartbeat = useCallback(() => {
    return Math.floor((Date.now() - lastHeartbeatRef.current) / 1000);
  }, []);

  return { getSecondsSinceLastHeartbeat };
}
