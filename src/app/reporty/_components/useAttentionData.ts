"use client";

import { useState, useEffect } from "react";
import {
  buildAttentionItems,
  attentionCalmSentence,
  type AttentionItem,
  type HealthInput,
  type OverbookedMachine,
  type WaitingReservation,
} from "@/lib/attentionItems";

/**
 * Tvar odpovědi `/api/report/attention`. Drží se doslova toho, co route vrací
 * (`checkedAt` + dvě pole) — kdyby se rozešel, `tsc` to nechytí, JSON z fetche
 * je pro typový systém neprůhledný.
 */
type ServerPart = { checkedAt: string; overbooked: OverbookedMachine[]; waiting: WaitingReservation[] };

export type UseAttentionData = {
  /** `false` = pás se NEVYKRESLÍ. Buď se ještě nenačetl, nebo fetch selhal. */
  ready: boolean;
  items: AttentionItem[];
  calm: string;
  checkedAt: string | null;
};

/**
 * Sloučí serverovou část pásu se stavem Kontrolního panelu, který si klient
 * stahuje sám (`useHealthData`). Skládání vět dělá `attentionItems.ts`, tenhle
 * hook jen sbírá vstupy — jinak by se věty serveru a klienta rozešly.
 *
 * Fetch běží JEDNOU při připojení a záměrně nezávisí na zvoleném období:
 * přeplánovaný stroj příští týden je problém i při pohledu na loňský leden.
 */
export function useAttentionData(health: HealthInput): UseAttentionData {
  const [server, setServer] = useState<ServerPart | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/report/attention");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ServerPart;
        if (!cancelled) setServer(json);
      } catch {
        // Selhání pásu NESMÍ shodit stránku ani ji zablokovat. Report je
        // použitelný i bez něj — stejná defenzivnost, jakou má Kontrolní
        // panel u dílčích kontrol. Vlastní stav `failed` (místo pouhého
        // `server == null`) drží rozdíl mezi „ještě nevíme" a „už víme, že
        // nevíme"; kdyby se sem někdy přidal retry, je na čem stavět.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (failed || server == null) {
    return { ready: false, items: [], calm: "", checkedAt: null };
  }

  const input = { overbooked: server.overbooked, waiting: server.waiting, health };
  return {
    ready: true,
    items: buildAttentionItems(input),
    calm: attentionCalmSentence(input),
    checkedAt: server.checkedAt,
  };
}
