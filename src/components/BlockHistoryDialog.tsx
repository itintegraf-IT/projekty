"use client";

import { useEffect, useRef } from "react";
import { BlockHistoryList } from "@/components/BlockHistoryList";
import ErrorMessage from "@/components/ui/ErrorMessage";
import LoadingSpinner from "@/components/ui/LoadingSpinner";
import { useBlockHistory } from "@/hooks/useBlockHistory";
import { machineLabel } from "@/lib/machines";
import { Z_OVERLAY } from "@/lib/zLayers";

/**
 * Historie změn jedné zakázky v modálu (etapa 3 září 2026, volby E1 = A a E2 = A).
 *
 * Pro DTP a MTZ je to JEDINÁ cesta k historii — pravý panel s detailem bloku se
 * jim nerenderuje (`PlannerPage.tsx`, `canEdit`). Plánovač má historii i v detailu;
 * dialog mu nabízí totéž bez nutnosti blok vybrat. Obsah je shodný s detailem,
 * poznámky tiskaře rolím bez práva odstraňuje už server (`visibleHistoryFor`).
 *
 * Modál, ne boční panel: DTP má vlevo `DtpPanel` a na 1366 px by další boční
 * panel časovou osu udusil. Shell (překryv, `role="dialog"`, zavření Esc i klikem
 * mimo) odpovídá sdílenému `ConfirmDialog`.
 *
 * Číslo zakázky a stroj dostává jako SNÍMEK z chvíle otevření, ne odkaz do živého
 * seznamu bloků: historie bloku přežije jeho smazání i přesun a dialog se nesmí
 * zavřít jen proto, že blok mezitím smazal někdo jiný.
 */
export function BlockHistoryDialog({
  blockId,
  orderNumber,
  machine,
  onClose,
}: {
  blockId: number;
  orderNumber: string;
  machine: string;
  onClose: () => void;
}) {
  const history = useBlockHistory(blockId);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Zavírá jen kliknutí, které na překryvu ZAČALO i SKONČILO. Tažení výběru textu
  // z historie, které skončí mimo panel, vyvolá `click` přímo na překryvu (cílem je
  // nejbližší společný předek) — bez téhle kontroly by dialog zmizel i s výběrem.
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    // Klávesy pod otevřeným dialogem NESMÍ dojít ke globálnímu handleru planneru
    // (`PlannerPage.tsx`: keydown na window v bublací fázi, ignoruje jen INPUT,
    // TEXTAREA a SELECT). Dialog žádné pole nemá, takže bez téhle zarážky by pod
    // ním Ctrl+Z tiše vrátil poslední akci, Delete otevřel mazání vybraného bloku,
    // Ctrl+C místo zkopírování textu z historie ukázal toast a Esc smazal hledání.
    // Capture fáze na window běží před každým jiným posluchačem a stopPropagation
    // zastaví zbytek cesty včetně bublací fáze na window. Výchozí akce prohlížeče
    // (Tab, kopírování označeného textu, Enter na tlačítku) běží dál. Zarážka ale
    // umlčí i VŠECHNY Reactí onKeyDown, i uvnitř dialogu (App Router hydratuje React
    // na `document`) — dialog proto žádné nemá; modál, který je potřebuje, musí jít
    // jinou cestou (viz CLAUDE.md, konvence kláves pod modálem).
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    // Fokus na zavírací tlačítko se zpožděním převzatým z `BlockNotesDialog`,
    // který se otevírá touž cestou — položkou kontextového menu karty.
    const t = setTimeout(() => closeRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const subtitle = orderNumber ? `${orderNumber} · ${machineLabel(machine)}` : machineLabel(machine);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z_OVERLAY.dialog,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnOverlay.current && e.target === e.currentTarget) onClose();
        pressedOnOverlay.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Historie změn · ${subtitle}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--popover)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 640,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: "var(--text)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Historie změn</div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Zavřít"
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-muted)",
              fontSize: 22,
              cursor: "pointer",
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
        {history.status === "loading" && <LoadingSpinner />}
        {history.status === "error" && (
          <ErrorMessage
            message={
              history.httpStatus === 403
                ? "K historii této zakázky nemáte přístup."
                : "Historii se nepodařilo načíst."
            }
          />
        )}
        {history.status === "ready" && history.entries.length === 0 && (
          <p style={{ margin: 0, padding: "24px 16px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            Zatím žádné změny.
          </p>
        )}
        {history.status === "ready" && history.entries.length > 0 && <BlockHistoryList entries={history.entries} />}
      </div>
    </div>
  );
}
