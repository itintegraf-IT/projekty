"use client";

import React from "react";
import { machineLabel } from "@/lib/machines";
import { KpiCard } from "./KpiCard";
import { heatToneFor, reportTypeScale, reportRadius } from "@/lib/reportTokens";
import { SectionHeader, DOW_LABELS, cz, type OutlookData, type OutlookMachineData } from "./reportShared";

/**
 * Hodnota karty „Volné hod." — u přeplánovaného stroje ZÁPORNÁ, ne useknutá nula.
 *
 * Nula by na kartě stála přímo vedle karty kapacity, která u téhož stroje hlásí
 * „přeplánováno o 26 h" — dvě čísla, jeden stroj, protimluv. Schodek se znaménkem
 * říká totéž jako sousední karta, jen v hodinách volna. Karta je duplicitní a etapa
 * R3 ji ruší, tohle je jen srovnání do doby, než zmizí.
 */
function freeHoursValue(m: OutlookMachineData | undefined): string {
  // Stroj bez směn nemá „0 h volných" — nemá kapacitu vůbec.
  if (m == null || m.plannedCapacity == null) return "—";
  if (m.overbookedHours > 0) return `−${cz(m.overbookedHours)} h`;
  return `${cz(m.freeHours)} h`;
}

/**
 * Podtitulek karty kapacity musí přiznat totéž co hodnota nad ním. Dokud se řídil jen
 * `freeHours ?? 0`, hlásila karta u stroje bez směn „—" a hned pod tím „0 h volných“ —
 * což se čte jako „stroj je plný". Táž ztráta rozdílu mezi „nevím" a „nula", jakou
 * etapa opravovala u procent, jen přenesená do hodin.
 */
function capacitySubtitle(m: OutlookMachineData | undefined): string {
  if (m == null || m.plannedCapacity == null) return "stroj nejede";
  if (m.overbookedHours > 0) return `přeplánováno o ${cz(m.overbookedHours)} h`;
  return `${cz(m.freeHours)} h volných`;
}

/**
 * Barva se řídí TÝMŽ signálem jako podtitulek (`overbookedHours`), ne zaokrouhleným
 * procentem. Jinak by při 100,4 % vyšel `Math.round` na 100, karta by svítila zeleně
 * a pod ní stálo „přeplánováno o 0,1 h".
 */
function capacityColor(m: OutlookMachineData | undefined): string | undefined {
  if (m == null || m.plannedCapacity == null) return undefined;
  if (m.overbookedHours > 0) return "var(--status-bad)";
  return m.plannedCapacity >= 80 ? "var(--status-ok)" : "var(--status-warn)";
}

export function OutlookView({ data }: { data: OutlookData }) {
  if (!data.dailyCapacity || !data.machines) return null;
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  const machines = ["XL_105", "XL_106"] as const;
  const days = data.dailyCapacity.slice(0, 14);

  return (
    <>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <KpiCard
          label="Kapacita XL 105"
          value={xl105?.plannedCapacity == null ? "—" : `${xl105.plannedCapacity}%`}
          subtitle={capacitySubtitle(xl105)}
          color={capacityColor(xl105)}
        />
        <KpiCard
          label="Kapacita XL 106"
          value={xl106?.plannedCapacity == null ? "—" : `${xl106.plannedCapacity}%`}
          subtitle={capacitySubtitle(xl106)}
          color={capacityColor(xl106)}
        />
        {/* Přeplánovaný stroj nemá „0 h volných", ale schodek. Bez znaménka by tahle karta
            tvrdila „0 h" hned vedle karty kapacity, která hlásí „přeplánováno o 26 h". */}
        <KpiCard
          label="Volné hod. XL 105"
          value={freeHoursValue(xl105)}
          subtitle={`z ${cz(xl105?.availableHours)} h`}
          color={capacityColor(xl105)}
        />
        <KpiCard
          label="Volné hod. XL 106"
          value={freeHoursValue(xl106)}
          subtitle={`z ${cz(xl106?.availableHours)} h`}
          color={capacityColor(xl106)}
        />
      </div>

      {/* KAPACITA */}
      <SectionHeader label="KAPACITA" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: 14 }}>
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Heatmapa vytížení</div>
        <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${days.length}, 1fr)`, gap: 2 }}>
          {/* Header row */}
          <div />
          {days.map((d) => {
            const dt = new Date(d.date + "T12:00:00Z");
            const dow = DOW_LABELS[dt.getUTCDay()];
            const dayNum = dt.getUTCDate();
            return (
              <div key={d.date} style={{ textAlign: "center", fontSize: reportTypeScale.xs, color: "var(--text-muted)", lineHeight: 1.2 }}>
                {dow}<br/>{dayNum}
              </div>
            );
          })}
          {/* Machine rows */}
          {machines.map((m) => (
            <React.Fragment key={m}>
              <div style={{ fontSize: reportTypeScale.xs, color: "var(--text)", display: "flex", alignItems: "center" }}>{machineLabel(m)}</div>
              {days.map((d) => {
                const val = (d[m] as number | null) ?? null;
                const tone = heatToneFor(val);
                return (
                  <div key={d.date} style={{
                    height: 28, borderRadius: reportRadius.xs, background: tone.fill,
                    // Barva sama nestačí: červená, jantarová a zelená jsou pro
                    // dichromata vzájemně nerozlišitelné (ΔOKLab 0,004–0,059).
                    // Hodnotu proto nese číslo v dlaždici, ne odstín — a stav,
                    // který volá po zásahu, dostane navíc rámeček. Podrobnosti
                    // v docstringu `heatToneFor`.
                    boxShadow: tone.overbooked ? "inset 0 0 0 2px var(--status-on)" : undefined,
                    // Prázdná dlaždice „stroj nejede" se od prázdné nuly liší
                    // jedině tvarem — odstíny mají kontrast 1,13 : 1.
                    border: tone.dashed ? "1px dashed var(--text-muted)" : undefined,
                    boxSizing: "border-box",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: reportTypeScale.xs, color: tone.text, fontWeight: 600,
                  }} title={`${d.date}: ${val == null ? "stroj nejede" : val > 100 ? val + " % — přeplánováno" : val + " %"}`}>
                    {val == null ? "" : val > 0 ? `${val}` : ""}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        {/* Legenda si barvy NEOPISUJE — protahuje zástupné procento touž funkcí
            `heatToneFor`, jakou kreslí mřížka, takže se od ní nemůže rozejít.
            Přesně tenhle rozchod měla R1: přibyla větev „nad 100 %" a stav
            „stroj nejede", legenda o nich nevěděla a červená měla dva významy.
            Čtvereček je 12 px, ne 10: při 1px okraji a 2px rámečku by z 10px
            zbyly 4 px skutečné barvy a klíč by neukazoval to, co popisuje. */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          {([
            { pct: 120, label: "nad 100 % — přeplánováno" },
            { pct: 90, label: "80–100 %" },
            { pct: 60, label: "50–79 %" },
            { pct: 30, label: "pod 50 %" },
            { pct: 0, label: "0 %" },
            { pct: null, label: "stroj nejede" },
          ] as Array<{ pct: number | null; label: string }>).map((it) => {
            const tone = heatToneFor(it.pct);
            return (
              <span key={it.label} style={{ fontSize: reportTypeScale.xs, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
                <span style={{
                  width: 12, height: 12, borderRadius: reportRadius.xs, background: tone.fill,
                  display: "inline-block", boxSizing: "border-box",
                  border: tone.dashed ? "1px dashed var(--text-muted)" : "1px solid var(--border)",
                  boxShadow: tone.overbooked ? "inset 0 0 0 2px var(--status-on)" : undefined,
                }} /> {it.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* RIZIKA */}
      <SectionHeader label="RIZIKA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Planned maintenance */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: 14 }}>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Plánované údržby</div>
          {data.upcomingMaintenance.slice(0, 5).map((m, i) => {
            const startDt = new Date(m.startTime);
            const endDt = new Date(m.endTime);
            const hours = Math.round((endDt.getTime() - startDt.getTime()) / 3600000 * 10) / 10;
            return (
              <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontSize: reportTypeScale.sm, fontWeight: 600, color: "var(--text)" }}>{machineLabel(m.machine)}</div>
                <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)" }}>{m.description}</div>
                <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)" }}>
                  {startDt.toISOString().slice(0, 10)} · {cz(hours)} h
                </div>
              </div>
            );
          })}
          {data.upcomingMaintenance.length === 0 && (
            <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>Žádné plánované údržby</div>
          )}
        </div>
        {/* Pending reservations */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: 14 }}>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Čekající na zpracování</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <KpiCard label="Nové rezervace" value={data.pendingReservations.newCount} subtitle="čeká na přijetí" />
            <KpiCard label="Ve frontě" value={data.pendingReservations.queueCount} subtitle="připraveno k plánování" />
          </div>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
            Nejstarší čekající: <strong style={{ color: data.pendingReservations.oldestWaitingDays > 3 ? "var(--status-bad)" : "var(--text)" }}>
              {data.pendingReservations.newCount === 0 ? "—" : `${data.pendingReservations.oldestWaitingDays} dní`}
            </strong>
            <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2 }}>stav k dnešku, nezávisle na období</div>
          </div>
        </div>
      </div>
    </>
  );
}
