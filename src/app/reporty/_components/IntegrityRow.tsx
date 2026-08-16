"use client";

import React, { useState } from "react";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";
import type { IntegrityIssue } from "./useHealthData";
import CheckExplainer from "./CheckExplainer";

const TH: React.CSSProperties = {
  textAlign: "left", fontSize: reportTypeScale.xs, letterSpacing: ".09em", textTransform: "uppercase",
  color: "var(--text-muted)", fontWeight: 600, padding: `${reportSpace.sm}px ${reportSpace.md}px`,
  background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
};
const TD: React.CSSProperties = {
  padding: `${reportSpace.sm}px ${reportSpace.md}px`, borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: reportTypeScale.md,
};

/**
 * Odsazení poznámky pod řádkem. Levý okraj srovnává text pod POPISEK řádku,
 * ne pod tečku: 12 (vnitřek řádku) + 7 (tečka) + 9 (mezera) = 28, tedy
 * `xl + xs`. Kdo změní vnitřek řádku nebo mezeru, mění i tohle.
 */
const NOTE_PADDING = `0 ${reportSpace.md}px ${reportSpace.sm}px ${reportSpace.xl + reportSpace.xs}px`;

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Vede odkaz „Otevřít v plánu" na něco, co uživatel opravdu uvidí?
 *
 * `/?highlight=<id>` se v `app/page.tsx` NEPOUŽIJE jako id — přeloží se na
 * `orderNumber` nalezeného bloku a předá plánovači jako textový filtr. Dva stavy
 * proto slibují víc, než umí splnit, a je poctivější odkaz nenabízet:
 *  - prázdný `orderNumber` → filtr je prázdný řetězec a skok se nikdy nespustí,
 *  - `invalidMachine` → blok se strojem mimo MACHINES se v plánu nevykreslí vůbec
 *    (říká to i vysvětlivka u té kontroly, která posílá zásah do databáze).
 */
function canJump(issueKey: string, orderNumber: string): boolean {
  return orderNumber.trim().length > 0 && issueKey !== "invalidMachine";
}

/**
 * Jeden řádek rozpadu Integrity. Řádek s nálezem je klikací a rozbalí se do
 * vysvětlivky a tabulky VŠECH nálezů — dřív se z padesáti posílaných položek
 * zobrazila jedna. Nulový a nespočtený řádek se nerozbalují (není co ukázat).
 */
export default function IntegrityRow({ issue }: { issue: IntegrityIssue }) {
  const [open, setOpen] = useState(false);
  const uncomputed = issue.count === null;
  const bad = (issue.count ?? 0) > 0;
  const expandable = bad && issue.items.length > 0;

  // Tečka je 7px tvar nesoucí stav řádku — WCAG 1.4.11 chce 3 : 1 vůči podkladu.
  // `--warning` dává na kartě 1,86 : 1 a ztlumená zelená 2,20 : 1. Stavová
  // čtveřice je změřená (≥ 5 : 1) a je to týž signál jako hrana karty výš.
  const dotColor = uncomputed
    ? "var(--status-warn)"
    : bad
      ? "var(--status-bad)"
      : "var(--status-ok)";

  return (
    <div style={{ background: "var(--surface)" }}>
      <div
        onClick={() => expandable && setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 9, padding: `${reportSpace.sm}px ${reportSpace.md}px`, fontSize: reportTypeScale.md,
          cursor: expandable ? "pointer" : "default", userSelect: "none",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: dotColor }} />
        <span>{issue.label}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontVariantNumeric: "tabular-nums", fontWeight: 700,
            color: uncomputed ? "var(--warning-text)" : bad ? "var(--status-bad)" : "var(--text-muted)",
          }}>
            {uncomputed ? "nespočteno" : issue.count}
          </span>
          {expandable && (
            <span style={{ color: "var(--text-muted)", fontSize: reportTypeScale.sm, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
          )}
        </span>
      </div>

      {/* Důvod se vypisuje i bez `error` — holé „nespočteno" bez vysvětlení
          a bez možnosti rozbalit je slepá ulička. */}
      {uncomputed && (
        <div style={{ padding: NOTE_PADDING, fontSize: reportTypeScale.base, color: "var(--warning-text)" }}>
          Kontrola se nespočetla: {issue.error ?? "důvod neznámý"}
        </div>
      )}

      {/* Nález bez položek se nedá rozbalit — bez téhle hlášky svítí červené číslo,
          na které nejde kliknout a nikde není proč. */}
      {bad && issue.items.length === 0 && (
        <div style={{ padding: NOTE_PADDING, fontSize: reportTypeScale.base, color: "var(--text-muted)" }}>
          Detaily nejsou k dispozici.
        </div>
      )}

      {open && expandable && (
        <div style={{ padding: `0 ${reportSpace.md}px ${reportSpace.md}px` }}>
          <CheckExplainer copyKey={issue.key} />
          <div style={{ overflowX: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: reportRadius.lg }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={TH}>Zakázka</th>
                  <th style={TH}>Stroj</th>
                  <th style={TH}>Detail</th>
                  <th style={TH}></th>
                </tr>
              </thead>
              <tbody>
                {issue.items.map((item) => (
                  <tr key={item.id}>
                    <td style={TD}>
                      <span style={{ fontWeight: 600 }}>{item.orderNumber || `#${item.id}`}</span>
                      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>{fmtDateTime(item.startTime)}</div>
                    </td>
                    <td style={{ ...TD, fontWeight: 700, fontSize: reportTypeScale.base }}>{item.machine}</td>
                    {/* Rozešlá skupina může vypsat i deset polí — bez stropu a lámání
                        by jedno dlouhé slovo (popis, specifikace) roztáhlo tabulku. */}
                    <td style={{ ...TD, color: "var(--text-muted)", maxWidth: 420, overflowWrap: "anywhere" }}>{item.detail}</td>
                    <td style={TD}>
                      {canJump(issue.key, item.orderNumber) ? (
                        <a href={`/?highlight=${item.id}`} style={{ color: "var(--brand-text)", textDecoration: "none", fontSize: reportTypeScale.md, fontWeight: 600, whiteSpace: "nowrap" }}>
                          Otevřít v plánu →
                        </a>
                      ) : (
                        <span style={{ fontSize: reportTypeScale.base, color: "var(--text-muted)", whiteSpace: "nowrap" }}>v plánu nedohledatelný</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issue.count !== null && issue.count > issue.items.length && (
            <div style={{ marginTop: 6, fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
              Zobrazeno {issue.items.length} z {issue.count} nálezů.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
