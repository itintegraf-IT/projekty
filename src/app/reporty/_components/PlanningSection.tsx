"use client";

import React from "react";
import { formatPragueDate } from "@/lib/dateUtils";
import { KpiCard } from "./KpiCard";

/**
 * Metriky sekce PLÁNOVÁNÍ, jak je počítá `GET /api/report/dashboard` (retro režim).
 *
 * Zdrojem je od 8/2026 tabulka `BlockRevision` („černá skříňka" etapy B1), ne
 * `AuditLog`. Důvod je zásadní: přetažení jednoho bloku myší v auditu stopu
 * NEMÁ (`AUDITED_FIELDS` poziční sloupce neobsahuje), takže nejběžnější způsob
 * přesunu byl pro metriku neviditelný a karta hlásila 100% stabilitu vždycky.
 */
export type PlanningMetrics = {
  /** Je CELÉ zvolené období pokryté revizemi? Jinak se místo čísel ukáže „—". */
  covered: boolean;
  /** ISO datum nejstarší revize; `null` když jich není ani jedna. */
  coverageFrom: string | null;
  /** Počet serverových transakcí = rozhodnutí uživatele o poloze bloku. */
  interventionCount: number;
  /** Počet různých bloků, které se přitom pohnuly (včetně automaticky odsunutých). */
  movedBlockCount: number;
  stabilityPercent: number;
};

export type PlannerActivityEntry = { username: string; actionCount: number };

/**
 * Sekce PLÁNOVÁNÍ retro reportu: KPI dlaždice + žebříček aktivity plánovačů.
 * Vlastní nadpis (`SectionHeader`) si drží volající — sekce vykresluje jen obsah.
 */
export function PlanningSection({
  planning,
  plannerActivity,
  logins,
}: {
  planning: PlanningMetrics;
  plannerActivity: PlannerActivityEntry[];
  logins: { periodCount: number; activeUsers: number };
}) {
  // `?? false` chrání proti odpovědi ve starém tvaru (cache prohlížeče krátce
  // po deployi) — raději „—" než `undefined%` na kartě.
  const covered = planning?.covered ?? false;
  const coverageLabel = planning?.coverageFrom ? formatPragueDate(new Date(planning.coverageFrom)) : null;

  // Poměr „kolik bloků rozhýbe jeden zásah" je vlastní informační hodnota téhle
  // dvojice čísel: vložení spěchající zakázky doprostřed hustého dne posune
  // i deset dalších. Bez zásahů by šlo o dělení nulou, proto podtitulek zmizí.
  const movedPerIntervention =
    covered && planning.interventionCount > 0
      ? `⌀ ${(planning.movedBlockCount / planning.interventionCount).toFixed(1).replace(".", ",")} na zásah`
      : undefined;

  const maxActivity = Math.max(...plannerActivity.map((a) => a.actionCount), 1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <KpiCard
            label="Zásahy do plánu"
            value={covered ? planning.interventionCount : "—"}
            subtitle="rozhodnutí plánovače"
          />
          <KpiCard
            label="Posunuté bloky"
            value={covered ? planning.movedBlockCount : "—"}
            subtitle={movedPerIntervention}
          />
          <KpiCard
            label="Stabilita plánu"
            value={covered ? `${planning.stabilityPercent}%` : "—"}
            subtitle="bloků beze změny"
          />
          <KpiCard
            label="Přihlášení za období"
            value={logins.periodCount}
            subtitle={`${logins.activeUsers} aktivních uživatelů`}
          />
        </div>
        {!covered && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
            {coverageLabel
              ? `Data o změnách plánu jsou k dispozici od ${coverageLabel}.`
              : "Zatím nejsou k dispozici žádná data o změnách plánu."}
          </div>
        )}
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        {/* Počet ULOŽENÍ na uživatele, ne počet změněných polí — viz komentář v route. */}
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Aktivita plánovačů</div>
        {plannerActivity.map((a) => (
          <div key={a.username} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, width: 80, flexShrink: 0, color: "var(--text)" }}>{a.username}</span>
            <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${(a.actionCount / maxActivity) * 100}%`, height: "100%", background: "var(--brand)", borderRadius: 4 }} />
            </div>
            {/* `tabular-nums`: sloupec počtů zůstane zarovnaný i po přepnutí období. */}
            <span style={{ fontSize: 10, color: "var(--text-muted)", width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.actionCount}</span>
          </div>
        ))}
        {plannerActivity.length === 0 && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Žádná aktivita</div>}
      </div>
    </div>
  );
}
