"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { type Block } from "@/app/_components/TimelineGrid";
import { blockPrintMinutes } from "@/lib/printTimeClient";
import { usesTiskoveHodiny } from "@/lib/printTime";
import { Z_OVERLAY } from "@/lib/zLayers";
import { civilDateToUTCMidnight, normalizeCivilDateInput } from "@/lib/dateUtils";
import { hoverTooltipPlacement, TOOLTIP_W, type ColumnBox } from "@/lib/plannerHoverTooltip";

/**
 * Hover bublina nad kartou bloku v planneru („okno s podrobnostmi").
 *
 * Vytažená z `BlockCard.tsx` 14. 9. 2026 (commit ae35fe6c, beze změny
 * chování); poloha nad sousedním strojem a prodleva 400 ms přibyly
 * v navazujícím commitu. Soubor měl 1856 řádků při limitu 500 (pravidlo
 * „extract before add", CLAUDE.md) a bublina je uzavřený celek s vlastním
 * stavem (naměřená výška, poloha).
 *
 * KDY se bublina ukáže, rozhoduje volající přes `open`; tady se řeší jen poloha
 * a obsah. Portálovaná do `body`, mimo stacking context mřížky. Pravidla polohy
 * žijí v `src/lib/plannerHoverTooltip.ts`.
 */
export function BlockHoverTooltip({
  block, anchorRef, open, splitTotal, splitTotalMinutes,
}: {
  block: Block;
  /** Karta bloku — z ní se čte poloha a sloupec stroje. */
  anchorRef: RefObject<HTMLDivElement>;
  /** Má se bublina ukázat (rozhoduje `BlockCard`). */
  open: boolean;
  /** Počet částí split skupiny a jejich Σ tiskový čas (řádek „Skupina: Σ …"). */
  splitTotal?: number;
  splitTotalMinutes?: number;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  // Naměří skutečnou výšku hover bubliny PO jejím vykreslení do DOM, ale PŘED
  // prvním malováním obrazovky (proto useLayoutEffect, ne useEffect) — díky
  // tomu uživatel nikdy neuvidí bublinu na provizorní pozici z prvního snímku.
  // Bez deps pole běží po každém commitu (zavřená bublina → tooltipRef.current
  // je null → měřená výška 0 → stav se sám vrátí na 0). `setState` s hodnotou
  // shodnou s předchozí Reactu bail-outuje, takže to nezpůsobí smyčku.
  useLayoutEffect(() => {
    const measured = tooltipRef.current?.getBoundingClientRect().height ?? 0;
    setTooltipHeight((prev) => (prev === measured ? prev : measured));
  });

  if (!open) return null;
  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect || typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Poloha: nad SOUSEDNÍM strojem, pravou hranou k jeho sloupci, ve výšce karty;
  // záchranný režim (tiskař s jedním sloupcem, chybějící hák, úzké okno) =
  // dřívější pravidlo pod kartou. Pravidlo, pořadí záchran i historie viz
  // `src/lib/plannerHoverTooltip.ts` — tady zůstává jen odečet geometrie.
  //
  // Sloupce strojů jsou v mřížce sourozenci s hákem `data-machine-col`
  // (`TimelineGrid.tsx`), pořadí v DOM = pořadí zleva doprava.
  const colEl = anchorRef.current?.closest("[data-machine-col]") ?? null;
  const siblings = colEl?.parentElement
    ? Array.from(colEl.parentElement.children).filter((el) => el.hasAttribute("data-machine-col"))
    : [];
  const columns: ColumnBox[] = siblings.map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  const { left, top } = hoverTooltipPlacement({
    columns,
    ownIndex: colEl ? siblings.indexOf(colEl) : -1,
    cardRect: { top: rect.top, bottom: rect.bottom, right: rect.right },
    tooltipHeight,
    viewportWidth: vw,
    viewportHeight: vh,
  });
  // Format time
  const startD = new Date(block.startTime);
  const endD   = new Date(block.endTime);
  const fmtTime = (d: Date) => d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
  const fmtDay  = (d: Date) => d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", timeZone: "Europe/Prague" });
  const sameDay = fmtDay(startD) === fmtDay(endD);
  const timeLabel = sameDay
    ? `${fmtDay(startD)}, ${fmtTime(startD)}–${fmtTime(endD)}`
    : `${fmtDay(startD)} ${fmtTime(startD)} – ${fmtDay(endD)} ${fmtTime(endD)}`;
  const machineLabel = block.machine === "XL_105" ? "XL 105" : "XL 106";
  const hasDateInfo = block.dataRequiredDate || block.materialRequiredDate || block.deadlineExpedice;
  // Řádek délky: ZAKAZKA s tiskovými minutami odlišnými od uplynulého času bloku
  // (pauza přes odstávku/mimo provoz uvnitř bloku) zobrazí tisk i celek zvlášť.
  const fmtHoursTip = (mins: number) => {
    const h = mins / 60;
    return h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`;
  };
  const elapsedMinsTip = Math.round((endD.getTime() - startD.getTime()) / 60000);
  // usesTiskoveHodiny, ne holé `type === "ZAKAZKA"` (F5, finální review etapy 9) —
  // tisková rezervace má printMinutes taky a bublina má ukázat „Tisk: X · Celkem: Y",
  // ne jen uplynulý čas.
  const pmTip = usesTiskoveHodiny(block) ? blockPrintMinutes(block) : null;
  const durationLabel = (pmTip != null && pmTip !== elapsedMinsTip)
    ? `Tisk: ${fmtHoursTip(pmTip)} · Celkem: ${fmtHoursTip(elapsedMinsTip)}`
    : `Délka: ${fmtHoursTip(elapsedMinsTip)}`;
  const tiskarNotes = block.notes ?? [];
  return createPortal(
    <div ref={tooltipRef} style={{
      position: "fixed",
      left,
      top,
      width: TOOLTIP_W,
      zIndex: Z_OVERLAY.floating,
      background: "rgba(28,28,30,0.88)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 14,
      padding: "12px 14px",
      pointerEvents: "none",
      boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.25)",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Číslo zakázky + stroj */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: block.description || block.specifikace ? 3 : 6 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.01em" }}>
          {block.orderNumber}
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0, marginLeft: 8 }}>
          {machineLabel}
        </span>
      </div>
      {/* Popis */}
      {block.description && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4, marginBottom: block.specifikace ? 3 : 6 }}>
          {block.description}
        </div>
      )}
      {/* Specifikace */}
      {block.specifikace && (
        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", fontStyle: "italic", lineHeight: 1.35, marginBottom: 6 }}>
          {block.specifikace}
        </div>
      )}
      {/* Čas */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
        {timeLabel}
      </div>
      {/* Délka — tisk vs. celkový čas na ose, když se liší (blok obsahuje pauzu) */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
        {durationLabel}
      </div>
      {/* Σ tiskový čas celé split skupiny (bod 18 auditu) */}
      {(splitTotal ?? 0) > 1 && (splitTotalMinutes ?? 0) > 0 && (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
          {`Skupina: Σ ${fmtHoursTip(splitTotalMinutes!)} (${splitTotal} částí)`}
        </div>
      )}
      {/* Termíny */}
      {hasDateInfo && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 4 }}>
          {block.dataRequiredDate && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>DATA</span>
              <span style={{ color: block.dataOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(block.dataRequiredDate)}{block.dataOk ? " ✓" : ""}
              </span>
            </div>
          )}
          {block.materialRequiredDate && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>MATERIÁL</span>
              <span style={{ color: block.materialOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(block.materialRequiredDate)}{block.materialOk ? " ✓" : ""}
              </span>
            </div>
          )}
          {block.deadlineExpedice && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>EXPEDICE</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(block.deadlineExpedice)}
              </span>
            </div>
          )}
        </div>
      )}
      {/* Tiskařské poznámky — sekce v hoveru */}
      {tiskarNotes.length > 0 && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#f59e0b",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 2,
          }}>
            <span>📝 Poznámky tiskař</span>
            <span style={{
              background: "#f59e0b",
              color: "#1f2937",
              padding: "1px 5px",
              borderRadius: 8,
              fontSize: 9,
              fontWeight: 700,
            }}>{tiskarNotes.length}</span>
          </div>
          {tiskarNotes.slice(0, 3).map((n) => (
            <div key={n.id} style={{ borderLeft: "2px solid #f59e0b", paddingLeft: 8 }}>
              <div style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.85)",
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
              }}>{n.text}</div>
              <div style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.32)",
                marginTop: 2,
                letterSpacing: "0.02em",
              }}>
                {n.createdByUsername} · {new Date(n.createdAt).toLocaleString("cs-CZ", {
                  day: "numeric", month: "numeric",
                  hour: "2-digit", minute: "2-digit",
                  timeZone: "Europe/Prague",
                })}
                {n.updatedAt !== n.createdAt && " · upraveno"}
              </div>
            </div>
          ))}
          {tiskarNotes.length > 3 && (
            <div style={{
              fontSize: 10,
              color: "#f59e0b",
              textAlign: "center",
              fontStyle: "italic",
              marginTop: 4,
            }}>
              + {tiskarNotes.length - 3} dalších
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── Pomocná funkce — bezpečný parse data z DB (ISO timestamp i date string) ──
// Přesunuto z `BlockCard.tsx` (14. 9. 2026) — bublina byla jejím jediným uživatelem.
function fmtDate(s: string | null | undefined): string {
  const normalized = normalizeCivilDateInput(s);
  if (!normalized) return "–";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(civilDateToUTCMidnight(normalized));
}
