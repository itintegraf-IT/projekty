"use client";

import React from "react";
import type { AttentionItem } from "@/lib/attentionItems";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";

const toneOf = (s: AttentionItem["severity"]) =>
  s === "bad" ? "var(--status-bad)" : "var(--status-warn)";

/**
 * Stavový pás nad obsahem Reportů. Vypisuje jen to, co vyžaduje pozornost.
 *
 * Klidný stav NENÍ prázdno — je to věta, která vyjmenuje, co bylo ověřeno.
 * Prázdný pás by se četl jako „nenačteno", a to je přesně ten omyl, kvůli
 * kterému má odznak Kontrolního panelu tři stavy místo dvou.
 *
 * Komponenta žádný text NESKLÁDÁ. Věty, prahy i pořadí položek přicházejí
 * hotové z `attentionItems.ts`, aby měly jediný zdroj pravdy sdílený se
 * serverem.
 */
export function AttentionBand({ items, calm, checkedAt, fullyVerified, onSwitchTab }: {
  items: AttentionItem[];
  calm: string;
  checkedAt: string | null;
  /** `false` → místo tučného „Nic nevyžaduje pozornost" se přizná neúplnost. */
  fullyVerified: boolean;
  /** Přepnutí záložky NA MÍSTĚ. Viz `AttentionTarget` — odkaz to být nemůže. */
  onSwitchTab: (tab: "retro" | "outlook" | "health") => void;
}) {
  const linkStyle: React.CSSProperties = {
    fontSize: reportTypeScale.md, fontWeight: 600, color: "var(--brand-text)",
    textDecoration: "none", whiteSpace: "nowrap",
  };
  const alert = items.length > 0;
  /*
   * TŘI stavy, ne dva — stejně jako odznak Kontrolního panelu.
   *
   * Bez prostředního stavu pás vypsal tučné „Nic nevyžaduje pozornost.“ ve
   * chvíli, kdy o kontrolách nevěděl vůbec nic (fetch health ještě neběžel
   * nebo selhal), a na sousední záložce přitom svítil jantarový odznak „!“.
   * Dvě protichůdná tvrzení ve stejné hlavičce.
   */
  const edge = alert
    ? "color-mix(in oklab, var(--status-bad) 40%, var(--border))"
    : fullyVerified
      ? "color-mix(in oklab, var(--status-ok) 40%, var(--border))"
      : "color-mix(in oklab, var(--status-warn) 40%, var(--border))";

  return (
    <div style={{
      background: "var(--surface)", border: `1px solid ${edge}`,
      borderRadius: reportRadius.lg, overflow: "hidden", marginBottom: 12,
    }}>
      {alert ? (
        <>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
            padding: `${reportSpace.md}px ${reportSpace.md}px ${reportSpace.sm}px`, borderBottom: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: reportTypeScale.md, fontWeight: 700 }}>Vyžaduje pozornost</span>
            <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
              {/* Razítko platí JEN pro kapacitu a rezervace — ty přicházejí
                  z jednoho fetche. Položky Kontrolního panelu se počítají
                  z `useHealthData` při každém renderu, takže po kliknutí na
                  „Překontrolovat teď" se v pásu objeví nový počet nálezů pod
                  starým časem. Popisek to musí přiznat, jinak razítko lže
                  o části obsahu. */}
              kapacita a rezervace k {checkedAt
                ? new Date(checkedAt).toLocaleString("cs-CZ", {
                    timeZone: "Europe/Prague", day: "numeric", month: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })
                : "—"}
              {" · nezávisle na zvoleném období"}
            </span>
          </div>
          {items.map((it, i) => (
            <div key={it.key} style={{
              display: "flex", alignItems: "center", gap: 10, padding: `${reportSpace.sm}px ${reportSpace.md}px`,
              fontSize: reportTypeScale.md,
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: reportRadius.pill, flexShrink: 0, background: toneOf(it.severity) }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 650 }}>{it.title}</b>
                {it.detail ? ` — ${it.detail}` : ""}
              </span>
              {it.when && (
                <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {it.when}
                </span>
              )}
              {it.target.kind === "href" ? (
                <a href={it.target.href} style={linkStyle}>{it.target.label}</a>
              ) : (
                // Tlačítko, ne odkaz: cíl je záložka téže stránky, kterou drží
                // lokální stav. `<a>` by udělal reload a přistál na výchozí
                // záložce — tedy hůř než kdyby tam odkaz nebyl vůbec.
                <button
                  type="button"
                  onClick={() => onSwitchTab(it.target.kind === "tab" ? it.target.tab : "retro")}
                  style={{ ...linkStyle, background: "none", border: "none", padding: "0", cursor: "pointer" }}
                >
                  {it.target.label}
                </button>
              )}
            </div>
          ))}
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: `${reportSpace.md}px ${reportSpace.lg}px`, fontSize: reportTypeScale.md }}>
          <span style={{
            width: 20, height: 20, borderRadius: reportRadius.pill, flexShrink: 0,
            background: fullyVerified ? "var(--status-ok)" : "var(--status-warn)",
            color: "var(--status-on)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: reportTypeScale.base, fontWeight: 800,
          }}>{fullyVerified ? "✓" : "⚠"}</span>
          <span>
            <b style={{ fontWeight: 650 }}>
              {fullyVerified ? "Nic nevyžaduje pozornost." : "Zatím bez nálezu, ale ne všechno se podařilo ověřit."}
            </b>{" "}
            {calm}
          </span>
        </div>
      )}
    </div>
  );
}
