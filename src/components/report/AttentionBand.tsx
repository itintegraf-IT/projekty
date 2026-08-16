"use client";

import React from "react";
import type { AttentionItem } from "@/lib/attentionItems";
import { reportTypeScale, reportRadius } from "@/lib/reportTokens";

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
export function AttentionBand({ items, calm, checkedAt, onSwitchTab }: {
  items: AttentionItem[];
  calm: string;
  checkedAt: string | null;
  /** Přepnutí záložky NA MÍSTĚ. Viz `AttentionTarget` — odkaz to být nemůže. */
  onSwitchTab: (tab: "retro" | "outlook" | "health") => void;
}) {
  const linkStyle: React.CSSProperties = {
    fontSize: reportTypeScale.md, fontWeight: 600, color: "var(--brand-text)",
    textDecoration: "none", whiteSpace: "nowrap",
  };
  const alert = items.length > 0;
  const edge = alert
    ? "color-mix(in oklab, var(--status-bad) 40%, var(--border))"
    : "color-mix(in oklab, var(--status-ok) 40%, var(--border))";

  return (
    <div style={{
      background: "var(--surface)", border: `1px solid ${edge}`,
      borderRadius: reportRadius.lg, overflow: "hidden", marginBottom: 12,
    }}>
      {alert ? (
        <>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
            padding: "11px 14px 9px", borderBottom: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: reportTypeScale.md, fontWeight: 700 }}>Vyžaduje pozornost</span>
            <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
              stav k {checkedAt
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
              display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
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
                  style={{ ...linkStyle, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                >
                  {it.target.label}
                </button>
              )}
            </div>
          ))}
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 14px", fontSize: reportTypeScale.md }}>
          <span style={{
            width: 20, height: 20, borderRadius: reportRadius.pill, flexShrink: 0,
            background: "var(--status-ok)", color: "var(--status-on)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: reportTypeScale.base, fontWeight: 800,
          }}>✓</span>
          <span><b style={{ fontWeight: 650 }}>Nic nevyžaduje pozornost.</b> {calm}</span>
        </div>
      )}
    </div>
  );
}
