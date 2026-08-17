"use client";

import React from "react";
import { MACHINES, machineLabel } from "@/lib/machines";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";
import { cz, type RetroMachineData } from "./reportShared";

/**
 * Kolik dní musí období mít, aby se kaskáda vůbec kreslila.
 *
 * U „Dnes" je kalendář 24 h, z toho jedna směna — poměr by vypadal jako
 * katastrofa, přestože o využití kalendáře neříká nic. Sekce se proto pod
 * týdnem nekreslí a MÍSTO NÍ stojí věta, proč tam není: beze slova zmizelá
 * sekce se čte jako chyba a člověk hledá, co rozbil.
 */
const MIN_DAYS = 7;

/**
 * Hodiny z kaskády jdou z routy NEZAOKROUHLENÉ (na rozdíl od `productionHours`
 * a `availableHours`, které projdou `round1`). Je to záměr: rozpad nevyužitého
 * kalendáře musí sedět na součet a zaokrouhlení každé složky na serveru zvlášť
 * by ten invariant rozbilo.
 *
 * Zaokrouhlení je proto úkol téhle komponenty — `cz()` sama NEZAOKROUHLUJE,
 * takže `cz(cascade.staffedHours)` vypíše `153,90000000000003`.
 *
 * Pracuje se v DESETINÁCH hodiny jako v celých číslech: rozpad se na obrazovce
 * skládá do rovnice („nevyužitý kalendář X h = A · B · C"), a ta musí platit
 * i po zaokrouhlení. Sečíst tři zaokrouhlené desetiny je jediný způsob, jak to
 * zaručit; sečíst tři zaokrouhlená `number` v plovoucí čárce ne (0,1 + 0,2).
 */
const tenths = (hours: number): number => Math.round(hours * 10);
/** Desetiny hodiny → český zápis s desetinnou čárkou. */
const fmtTenths = (t: number): string => cz(t / 10);
/** Hodiny → český zápis, zaokrouhleno na jedno desetinné místo. */
const fmtHours = (hours: number): string => fmtTenths(tenths(hours));

/** Podíl na kalendáři v celých procentech; `null`, když kalendář není z čeho počítat. */
const shareOfCalendar = (part: number, calendar: number): number | null =>
  calendar > 0 ? Math.round((part / calendar) * 100) : null;

/** Šířka pásu v procentech, oříznutá do 0–100 — pás nesmí přetéct z karty. */
const barWidth = (part: number, calendar: number): number =>
  calendar > 0 ? Math.min(100, Math.max(0, (part / calendar) * 100)) : 0;

const LABEL_COL = "148px";
const HOURS_COL = "76px";
const PCT_COL = "52px";

function CascadeRow({ label, hours, calendarHours, color, showPercent, note }: {
  label: string;
  hours: number;
  calendarHours: number;
  color: string;
  /** Řádek kalendáře je základ, jeho „100 %" by bylo prázdné slovo. */
  showPercent: boolean;
  note?: string;
}) {
  const pct = shareOfCalendar(hours, calendarHours);
  return (
    <>
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>{label}</div>
      {/* Podklad pásu je `--surface-3` — táž výplň, jakou má v heatmapě dlaždice
          „stroj nejede". Nevyužitá část kalendáře je přesně to. */}
      <div style={{ background: "var(--surface-3)", borderRadius: reportRadius.xs, height: 12, overflow: "hidden" }}>
        <div style={{ width: `${barWidth(hours, calendarHours)}%`, height: "100%", background: color }} />
      </div>
      {/* Hodnotu nese ČÍSLO, ne barva pásu: semaforová trojice je pro dichromata
          nerozlišitelná (viz `heatToneFor` v reportTokens.ts). */}
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {fmtHours(hours)} h
      </div>
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {showPercent && pct != null ? `${pct} %` : ""}
      </div>
      <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
        {note ?? ""}
      </div>
    </>
  );
}

function MachineCascade({ machine, data }: { machine: string; data: RetroMachineData }) {
  const c = data.cascade;
  const calendar = c.calendarHours;

  /*
   * Čtvrtý krok se jmenuje „potvrzeno tiskařem", NE „odklepnuto" ani „vyrobeno",
   * a jeho procento je z NAPLÁNOVANÝCH hodin, ne z kalendáře. Rozdíl je celý
   * smysl toho řádku: při nízkém pokrytí `printCompletedAt` má říct „tiskaři
   * nepotvrzují", ne „nevyrobili jsme nic" (spec §3.1).
   *
   * Když se neplánovalo nic, je podíl `null` — a to se vypisuje slovy. Nula by
   * tvrdila, že tiskaři nepotvrdili to, co měli; „nebylo co potvrzovat" říká,
   * že nebylo co.
   */
  const confirmedNote = c.confirmedShareOfPlanned == null
    ? "— nebylo co potvrzovat"
    : `· ${c.confirmedShareOfPlanned} % naplánovaných`;

  // Rozpad se sčítá v desetinách, ať rovnice na obrazovce platí i po zaokrouhlení.
  const weekendT = tenths(c.unused.weekend);
  const shutdownT = tenths(c.unused.shutdown);
  const unstaffedT = tenths(c.unused.unstaffedShift);
  const unusedTotalT = weekendT + shutdownT + unstaffedT;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: reportSpace.md }}>
      <div style={{ fontSize: reportTypeScale.md, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
        {machineLabel(machine)}
        <span style={{ fontWeight: 400, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {" · "}{fmtHours(calendar)} h kalendáře
        </span>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `${LABEL_COL} minmax(0, 1fr) ${HOURS_COL} ${PCT_COL} auto`,
        alignItems: "center", columnGap: reportSpace.sm, rowGap: reportSpace.xs,
      }}>
        <CascadeRow label="kalendář" hours={calendar} calendarHours={calendar} color="var(--surface-3)" showPercent={false} />
        <CascadeRow label="obsazeno směnami" hours={c.staffedHours} calendarHours={calendar} color="var(--series-a)" showPercent />
        <CascadeRow label="naplánováno" hours={c.plannedHours} calendarHours={calendar} color="var(--status-warn)" showPercent />
        <CascadeRow label="potvrzeno tiskařem" hours={c.confirmedHours} calendarHours={calendar} color="var(--status-ok)" showPercent note={confirmedNote} />
      </div>
      {/*
        Poslední řádek je pointa celé sekce. „Neobsazené směny" jsou jediná
        z těch tří položek, kterou jde zvednout bez víkendového provozu a bez
        rušení plánovaných odstávek — proto se rozpad ukazuje, a ne jen součet.
      */}
      <div style={{
        fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginTop: 10,
        borderTop: "1px solid var(--border)", paddingTop: reportSpace.sm,
        fontVariantNumeric: "tabular-nums",
      }}>
        nevyužitý kalendář <strong style={{ color: "var(--text)" }}>{fmtTenths(unusedTotalT)} h</strong>
        {" = "}víkendy {fmtTenths(weekendT)} h
        {" · "}odstávky {fmtTenths(shutdownT)} h
        {" · "}neobsazené směny <strong style={{ color: "var(--text)" }}>{fmtTenths(unstaffedT)} h</strong>
      </div>
    </div>
  );
}

/**
 * Sekce VYUŽITÍ KALENDÁŘE retrospektivy.
 *
 * Nesmí se jmenovat „KAPACITA" — tak se jmenuje sekce ve **Výhledu** a znamená
 * něco jiného (volné hodiny dopředu). Dvě stejnojmenné sekce na dvou záložkách
 * jsou přesně ten zmatek, který odstraňovala etapa R3.
 *
 * Odpovídá na otázku, kterou karta „Vytížení" položit neumí: vytížení je poměr
 * naplánovaných hodin k OBSAZENÝM směnám, takže o kalendáři neříká nic. Stroj
 * na jednu směnu může mít vytížení 95 % a přitom stát tři čtvrtiny roku.
 *
 * Vlastní nadpis (`SectionHeader`) si drží volající — sekce vykresluje jen obsah.
 */
export function CalendarUseSection({ machines, dayCount }: {
  machines: Record<string, RetroMachineData>;
  dayCount: number;
}) {
  if (dayCount < MIN_DAYS) {
    return (
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
        Využití kalendáře se počítá od období delšího než týden.
      </div>
    );
  }

  // `cascade` může chybět, když prohlížeč krátce po deployi drží v cache starou
  // odpověď API. Raději o stroji mlčet než spadnout na `undefined.calendarHours`.
  const shown = MACHINES.filter((m) => machines[m]?.cascade != null);
  if (shown.length === 0) {
    return (
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
        Využití kalendáře se pro tohle období nepodařilo spočítat.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {shown.map((m) => <MachineCascade key={m} machine={m} data={machines[m]} />)}
    </div>
  );
}
