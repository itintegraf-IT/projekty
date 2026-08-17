"use client";

import React from "react";
import { MACHINES, machineLabel } from "@/lib/machines";
import { reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";
import { cz, type RetroMachineData } from "./reportShared";
import { tenths, shareOfCalendar, breakdownTenths } from "@/lib/calendarCascadeView";

/**
 * Kolik dní musí období mít, aby se kaskáda vůbec kreslila.
 *
 * U „Dnes" je kalendář 24 h, z toho jedna směna — poměr by vypadal jako
 * katastrofa, přestože o využití kalendáře neříká nic. Sekce se proto pod
 * týdnem nekreslí a MÍSTO NÍ stojí věta, proč tam není: beze slova zmizelá
 * sekce se čte jako chyba a člověk hledá, co rozbil.
 *
 * Podmínka je `dayCount < MIN_DAYS`, takže SEDMIDENNÍ období se JEŠTĚ vykreslí.
 * Věta níž proto musí říkat „alespoň týden", ne „delší než týden" — dřívější
 * znění tvrdilo pravý opak toho, co kód dělá.
 */
const MIN_DAYS = 7;

/**
 * Výška pásu v pixelech.
 *
 * NENÍ to krok `reportSpace` — ta škála je pro ODSAZENÍ, ne pro geometrii
 * prvku, a `height: reportSpace.md` by čtenáři tvrdilo něco, co neplatí.
 * Pojmenovaná konstanta je tu proto, aby číslo mělo význam a měnilo se na
 * jednom místě; strážný test v `reportTokens.test.ts` holé rozměry v JSX hlásí.
 */
const BAR_HEIGHT_PX = 12;

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
 * skládá do rovnice („nevyužitý kalendář X h = A · B · C · D"), a ta musí platit
 * i po zaokrouhlení. Sečíst zaokrouhlené desetiny je jediný způsob, jak to
 * zaručit; sečíst zaokrouhlená `number` v plovoucí čárce ne (0,1 + 0,2).
 */
/** Desetiny hodiny → český zápis s desetinnou čárkou. */
const fmtTenths = (t: number): string => cz(t / 10);
/** Hodiny → český zápis, zaokrouhleno na jedno desetinné místo. */
const fmtHours = (hours: number): string => fmtTenths(tenths(hours));

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
      <div style={{ background: "var(--surface-3)", borderRadius: reportRadius.xs, height: BAR_HEIGHT_PX, overflow: "hidden" }}>
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

/**
 * Paleta kaskády — ČTYŘI kroky, tři z nich barevné.
 *
 * Semafor se tu ZÁMĚRNĚ nepoužívá jako paleta sérií. Na téže stránce znamená
 * `--status-warn` v heatmapě vytížení 50–79 % a `--status-ok` 80–100 %, takže
 * trénované oko čte jantarový pás „naplánováno" jako varovný STAV — a přitom
 * je to prostě třetí krok kaskády, který má být menší než druhý. Kroky 2 a 3
 * proto nesou neutrální dvojici sérií (`--series-a`/`--series-b`, u níž je
 * doložené, že ji od sebe rozezná i dichromat), a `--status-ok` zůstává jedinému
 * kroku, u kterého „zeleně = hotovo" opravdu platí: potvrzenému tisku.
 *
 * Řádek „kalendář" je referenční 100 % a NESMÍ mít výplň `--surface-3` —
 * tou je nakreslené koryto všech pásů, takže referenční řádek byl k nerozeznání
 * od prázdné části ostatních. Nese proto neutrální `--text-muted`: je to jediný
 * tón, který na korytu spolehlivě drží v obou režimech a přitom nepředstírá,
 * že kalendář je taky nějaká série dat.
 */
const STEP_COLOR = {
  calendar: "var(--text-muted)",
  staffed: "var(--series-a)",
  planned: "var(--series-b)",
  confirmed: "var(--status-ok)",
} as const;

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
   *
   * Podíl se počítá TADY, přestože ho `computeCalendarCascade` posílá hotový
   * v `confirmedShareOfPlanned`. Server ho zaokrouhluje `Math.round`, takže
   * 99,5–99,99 % vypíše jako „100 %" — a „100 % naplánovaných" musí znamenat
   * úplně všechno, jinak se na to číslo nedá spolehnout. `Math.floor` na
   * syrových hodinách to řeší bez zásahu do serverového pole, které je součástí
   * odpovědi API a čtou ho i jiní. Rozdíl mezi oběma čísly je nanejvýš 1 p. b.
   * a jen ve prospěch přísnosti.
   */
  const confirmedPct = c.plannedHours > 0
    ? Math.floor((c.confirmedHours / c.plannedHours) * 100)
    : null;
  const confirmedNote = confirmedPct == null
    ? "— nebylo co potvrzovat"
    : `· ${confirmedPct} % naplánovaných`;

  const { totalT, weekendT, shutdownT, noRosterT, unstaffedT } = breakdownTenths(c);

  /*
   * `plannedHours > staffedHours` NENÍ chyba vykreslení, ale běžný stav: odložené
   * zakázky (`scheduleBypassed`), bloky ležící mimo pracovní dobu a legacy bloky
   * bez `printMinutes` (u těch spadne `printOverlapMinutes` na celý elapsed span).
   * Třetí pás je pak delší než druhý a bez vysvětlení to čtenář přečte jako vadu
   * grafu. Je to užitečná informace, ne omluva — proto se vypisuje o kolik.
   */
  const overStaffedT = tenths(c.plannedHours) - tenths(c.staffedHours);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: reportSpace.md }}>
      <div style={{ fontSize: reportTypeScale.md, fontWeight: 600, color: "var(--text)", marginBottom: reportSpace.sm }}>
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
        <CascadeRow label="kalendář" hours={calendar} calendarHours={calendar} color={STEP_COLOR.calendar} showPercent={false} />
        <CascadeRow label="obsazeno směnami" hours={c.staffedHours} calendarHours={calendar} color={STEP_COLOR.staffed} showPercent />
        <CascadeRow label="naplánováno" hours={c.plannedHours} calendarHours={calendar} color={STEP_COLOR.planned} showPercent />
        <CascadeRow label="potvrzeno tiskařem" hours={c.confirmedHours} calendarHours={calendar} color={STEP_COLOR.confirmed} showPercent note={confirmedNote} />
      </div>
      {/*
        Poslední řádek je pointa celé sekce. „Neobsazené směny" jsou jediná
        z těch položek, kterou jde zvednout bez víkendového provozu a bez
        rušení plánovaných odstávek — proto se rozpad ukazuje, a ne jen součet.

        „Chybí rozvrh" se vypisuje JEN když není nulová. Není to kosmetika:
        je to jediná složka, o které report nic neví (v `MachineWeekShifts`
        chybí řádek, typicky protože ten týden nikdo neotevřel v administraci),
        takže musí stát vedle čísla, které se tváří důvěryhodně. Nulová se
        naopak vynechává, ať se řádek zbytečně neprodlužuje.
      */}
      <div style={{
        fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginTop: reportSpace.sm,
        borderTop: "1px solid var(--border)", paddingTop: reportSpace.sm,
        fontVariantNumeric: "tabular-nums",
      }}>
        nevyužitý kalendář <strong style={{ color: "var(--text)" }}>{fmtTenths(totalT)} h</strong>
        {" = "}víkendy {fmtTenths(weekendT)} h
        {" · "}odstávky {fmtTenths(shutdownT)} h
        {noRosterT !== 0 && <>{" · "}chybí rozvrh {fmtTenths(noRosterT)} h</>}
        {" · "}neobsazené směny <strong style={{ color: "var(--text)" }}>{fmtTenths(unstaffedT)} h</strong>
      </div>
      {overStaffedT > 0 && (
        <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: reportSpace.xs }}>
          Naplánováno přesahuje obsazené směny o <strong style={{ color: "var(--text)" }}>{fmtTenths(overStaffedT)} h</strong>
          {" "}— odložené zakázky a bloky ležící mimo pracovní dobu se plánují i tam, kde směna není.
        </div>
      )}
      {/* Táž poctivost jako u konverze rezervací níž na stránce: filtr je
          `printCompletedAt != null` BEZ ohledu na okamžik potvrzení, takže
          číslo není v čase stabilní a při opakovaném otevření téhož období
          může vyrůst. Kdo to neví, myslí si, že report jednou lhal. */}
      <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: reportSpace.xs }}>
        „Potvrzeno tiskařem“ počítá bloky naplánované v období, které mají odklepnutý tisk — bez ohledu na to,
        kdy se odklepl. Zakázka z konce období potvrzená až po jeho konci se do čísla doplní zpětně.
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
        Využití kalendáře se počítá od období dlouhého alespoň týden.
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
    <div style={{ display: "flex", flexDirection: "column", gap: reportSpace.md }}>
      {shown.map((m) => <MachineCascade key={m} machine={m} data={machines[m]} />)}
    </div>
  );
}
