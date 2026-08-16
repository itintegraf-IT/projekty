"use client";

import React from "react";
import { machineLabel } from "@/lib/machines";
import { KpiCard } from "./KpiCard";
import { heatToneFor, reportTypeScale, reportRadius, reportSpace } from "@/lib/reportTokens";
import { ATTENTION_THRESHOLDS, plural } from "@/lib/attentionItems";
import { SectionHeader, DOW_LABELS, cz, type OutlookData, type OutlookMachineData } from "./reportShared";

/**
 * Podtitulek karty kapacity musí přiznat totéž co hodnota nad ním. Dokud se řídil jen
 * `freeHours ?? 0`, hlásila karta u stroje bez směn „—" a hned pod tím „0 h volných“ —
 * což se čte jako „stroj je plný". Táž ztráta rozdílu mezi „nevím" a „nula", jakou
 * etapa opravovala u procent, jen přenesená do hodin.
 *
 * Od R3 je tenhle podtitulek JEDINÝM nositelem hodin volna: samostatné karty
 * „Volné hod." byly duplicitou téhož čísla vedle téhož stroje.
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

/** Kolik nejbližších údržeb se vypíše. Strop je v UI PŘIZNANÝ, ne tichý. */
const MAINTENANCE_LIMIT = 5;

/**
 * Nad tolik dní se do dlaždice heatmapy dvouciferné číslo nevejde.
 *
 * Práh se počítá z POČTU DNÍ, ne z měření DOM: komponenta se renderuje i na
 * serveru a obě strany musí vykreslit totéž, jinak React hlásí neshodu
 * hydratace. Týdenní i čtrnáctidenní pohled tak zůstává s čísly, měsíční je
 * jen barevná mapa — hodnotu u něj nese `title` dlaždice.
 */
const HEATMAP_NUMBERS_MAX_DAYS = 20;

export function OutlookView({ data }: { data: OutlookData }) {
  if (!data.dailyCapacity || !data.machines) return null;
  const xl105 = data.machines["XL_105"];
  const xl106 = data.machines["XL_106"];
  const machines = ["XL_105", "XL_106"] as const;
  // Celé zvolené období. Ořez na 14 dní tu byl bez jakékoliv zmínky, takže
  // při měsíčním pohledu zmizelo 17 dní a nikdo se to nedozvěděl.
  const days = data.dailyCapacity;
  const showNumbers = days.length <= HEATMAP_NUMBERS_MAX_DAYS;

  const maintenance = data.upcomingMaintenance.slice(0, MAINTENANCE_LIMIT);

  const pending = data.pendingReservations;
  // `?? []` je pojistka na první minuty po deployi, kdy prohlížeč může držet
  // starší tvar odpovědi bez `items`. Prázdný seznam je horší zpráva než pád.
  const pendingItems = pending.items ?? [];

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
      </div>

      {/* KAPACITA */}
      <SectionHeader label="KAPACITA" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: reportSpace.md }}>
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Heatmapa vytížení</div>
        {/* Posouvá se MŘÍŽKA ve vlastním kontejneru, ne stránka: měsíční období má
            31 sloupců a vodorovný posun celé stránky by rozhoupal i sekce, které
            se šířky netýkají. `minWidth` drží dlaždice čitelně široké. */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${days.length}, minmax(11px, 1fr))`, gap: 2, minWidth: 520 }}>
            {/* Header row */}
            <div />
            {days.map((d) => {
              const dt = new Date(d.date + "T12:00:00Z");
              const dow = DOW_LABELS[dt.getUTCDay()];
              const dayNum = dt.getUTCDate();
              return (
                <div key={d.date} style={{ textAlign: "center", fontSize: reportTypeScale.xs, color: "var(--text-muted)", lineHeight: 1.2 }}>
                  {/* U dlouhého období se hlavička zkracuje na samotné číslo dne —
                      zkratka dne v týdnu se do 11px sloupce nevejde. */}
                  {showNumbers ? <>{dow}<br/>{dayNum}</> : dayNum}
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
                      {/* `title` zůstává VŽDY: u měsíčního pohledu je jediným
                          nositelem hodnoty, protože číslo se do dlaždice nevejde. */}
                      {showNumbers && val != null && val > 0 ? `${val}` : ""}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
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
        {!showNumbers && (
          <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 6 }}>
            Při delším období se čísla do dlaždic nevejdou — hodnotu ukáže najetí myší.
          </div>
        )}
      </div>

      {/* RIZIKA */}
      <SectionHeader label="RIZIKA" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Planned maintenance */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: reportSpace.md }}>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Plánované údržby</div>
          {maintenance.map((m, i) => {
            const startDt = new Date(m.startTime);
            const endDt = new Date(m.endTime);
            const hours = Math.round((endDt.getTime() - startDt.getTime()) / 3600000 * 10) / 10;
            return (
              // Linka odděluje řádky OD SEBE, takže poslední ji nemá — mez se
              // počítá z délky vypsaného seznamu, ne ze stropu. S `i < 4` dostávala
              // při méně než pěti údržbách poslední položka linku, pod kterou už
              // nic nebylo.
              <div key={i} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: i < maintenance.length - 1 ? "1px solid var(--border)" : "none" }}>
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
          {data.upcomingMaintenance.length > MAINTENANCE_LIMIT && (
            <div style={{ marginTop: 6, fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
              Zobrazeno {MAINTENANCE_LIMIT} z {data.upcomingMaintenance.length} nejbližších údržeb.
            </div>
          )}
        </div>
        {/* Pending reservations */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: reportSpace.md }}>
          {/* Odkaz patří do hlavičky panelu, ne na řádek: `id` v seznamu je id
              REZERVACE, kdežto `/?highlight=` očekává id BLOKU. Řádek by tedy
              vedl na cizí zakázku, nebo na žádnou. */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>Čekající na zpracování</span>
            <a href="/rezervace" style={{
              fontSize: reportTypeScale.sm, fontWeight: 600, color: "var(--brand-text)",
              textDecoration: "none", whiteSpace: "nowrap",
            }}>Rezervace →</a>
          </div>
          {pendingItems.length === 0 ? (
            <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>Žádné čekající rezervace.</div>
          ) : (
            <>
              {pendingItems.map((r, i) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  marginBottom: 6, paddingBottom: 6,
                  borderBottom: i < pendingItems.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <span style={{ fontSize: reportTypeScale.sm, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{r.code}</span>
                  {/* Volný text požadavku bývá dlouhý — ořez patří sem, ne do API,
                      které má vracet, co je v databázi. */}
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: reportTypeScale.xs, color: "var(--text-muted)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{r.requestText}</span>
                  {/* Práh je TÝŽ, jaký hlásí stavový pás nad záložkami
                      (`ATTENTION_THRESHOLDS`) — dvě čísla o čekání na jedné
                      stránce se nesmí rozejít v tom, které z nich je už problém. */}
                  <span style={{
                    fontSize: reportTypeScale.xs, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                    color: r.waitingDays > ATTENTION_THRESHOLDS.reservationWaitingDays ? "var(--status-bad)" : "var(--text-muted)",
                  }}>čeká {r.waitingDays} {plural(r.waitingDays, "den", "dny", "dní")}</span>
                </div>
              ))}
              <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginTop: 8 }}>
                {pending.newCount} nové · {pending.queueCount} ve frontě k plánování
                <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2 }}>stav k dnešku, nezávisle na období</div>
              </div>
              {pending.totalCount > pendingItems.length && (
                <div style={{ marginTop: 6, fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
                  Zobrazeno {pendingItems.length} z {pending.totalCount} nejdéle čekajících.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
