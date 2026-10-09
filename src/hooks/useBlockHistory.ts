"use client";

import { useEffect, useState } from "react";
import {
  pickLoadedHistory,
  readBlockHistoryResponse,
  type BlockHistoryResult,
  type BlockHistoryState,
  type LoadedBlockHistory,
} from "@/lib/blockHistory";

/**
 * Historie jedné zakázky z `GET /api/blocks/[id]/audit` — JEDINÉ místo, které ji
 * v klientu načítá. Sdílí ho detail bloku (`BlockDetail.tsx`) a dialog historie
 * (`BlockHistoryDialog.tsx`, etapa 3 září 2026).
 *
 * Výsledek se ukládá spolu s číslem bloku a vrací se jen tehdy, když patří
 * TOMUHLE bloku (`pickLoadedHistory`), jinak `loading`. Odpověď, která doběhne až
 * po přepnutí na jiný blok, se zahodí (`ignore`) — jinak by mohla přepsat novější.
 * Neúspěch je `error` s HTTP kódem, ne prázdná historie (`readBlockHistoryResponse`).
 */
export function useBlockHistory(blockId: number): BlockHistoryState {
  const [loaded, setLoaded] = useState<LoadedBlockHistory | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/blocks/${blockId}/audit`)
      .then(readBlockHistoryResponse)
      .catch((): BlockHistoryResult => ({ status: "error", httpStatus: null }))
      .then((result) => {
        if (!ignore) setLoaded({ blockId, result });
      });
    return () => {
      ignore = true;
    };
  }, [blockId]);

  return pickLoadedHistory(loaded, blockId);
}
