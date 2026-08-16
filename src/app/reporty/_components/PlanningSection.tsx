"use client";

import React from "react";
import { formatPragueDate } from "@/lib/dateUtils";
import { KpiCard } from "./KpiCard";
import { reportTypeScale } from "@/lib/reportTokens";

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

/**
 * Jmenovitá aktivita plánovačů, jak ji `GET /api/report/dashboard` pořád vrací.
 *
 * Žebříček z UI zmizel v etapě R3 (rozhodnutí Vojty — jmenovité srovnávání lidí
 * do provozního reportu nepatří), ale **odpověď serveru se schválně nemění**:
 * po deployi má prohlížeč ještě chvíli v cache starý JSON i starý JS a tvar dat
 * se nesmí rozejít ani jedním směrem. Typ proto zůstává součástí `RetroData`
 * (`reportShared.tsx`) — popisuje, co API skutečně posílá, ne co se kreslí.
 */
export type PlannerActivityEntry = { username: string; actionCount: number };

/**
 * Sekce PLÁNOVÁNÍ retro reportu: KPI dlaždice.
 * Vlastní nadpis (`SectionHeader`) si drží volající — sekce vykresluje jen obsah.
 */
export function PlanningSection({
  planning,
  logins,
}: {
  planning: PlanningMetrics;
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

  // Jednosloupcově: po zrušení žebříčku (druhý sloupec) by grid `1fr 1fr`
  // nechal polovinu šířky prázdnou a karty by se zbytečně lámaly do dvou řad.
  return (
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
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginTop: 8 }}>
          {coverageLabel
            ? `Data o změnách plánu jsou k dispozici od ${coverageLabel}.`
            : "Zatím nejsou k dispozici žádná data o změnách plánu."}
        </div>
      )}
    </div>
  );
}
