"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Block } from "@/app/_components/TimelineGrid";
import { pickHeroBlock, todayQueue, runProgress } from "@/lib/monitorView";
import { findSplitPartner, getSplitChipState } from "@/lib/splitHelpers";
import { PrintDoneButton } from "@/components/planner/PrintDoneButton";
import { TiskarMachineToggle } from "@/components/TiskarMachineToggle";
import { MonitorQueue } from "@/components/monitor/MonitorQueue";
import { machineLabel, MACHINES } from "@/lib/machines";
import { formatPragueTime } from "@/lib/dateUtils";
import { VARIANT_CONFIG } from "@/lib/blockVariants";

type Props = {
  blocks: Block[];
  viewMachine: string;
  ownMachine: string | null;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  onOpenPlan: () => void;
  onOpenSearch: () => void;
  onMachineChange: (machine: string) => void;
  onSelectBlock: (block: Block) => void;
  onLogout: () => void;
};

const HEADER_BTN: CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  borderRadius: 8,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  font: "inherit",
  flexShrink: 0,
};

/**
 * Domovská obrazovka tiskaře u stroje. Vlevo velká karta zakázky, kterou má
 * právě na starosti, vpravo fronta dneška. Plán je o klik dál („Celý plán →").
 *
 * Komponenta nic nenačítá — bloky dostává z PlannerPage, která je drží a
 * udržuje aktuální přes SSE. `now` si ale tiká sama (stejný vzor jako
 * TimelineGrid): jinak v noci, kdy nechodí SSE ani se nic v plánu nemění,
 * Monitor zamrzne na čase posledního renderu PlannerPage a running →
 * overdue → upcoming přechod (a půlnoční posun fronty) vůbec nenastane.
 */
export function MonitorView({
  blocks, viewMachine, ownMachine,
  onPrintComplete, onOpenPlan, onOpenSearch, onMachineChange, onSelectBlock, onLogout,
}: Props) {
  // Vázané na konkrétní blok, ne na komponentu: po odklepnutí se hero karta
  // přepne na další zakázku ještě během požadavku a jeden sdílený boolean
  // by zašedil tlačítko, kterého se nikdo nedotkl.
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Krátké okno po libovolném odklepnutí, kdy je tlačítko HOTOVO zamčené i pro
  // NOVOU hero zakázku, která se sem optimisticky přepne dřív, než dorazí
  // odpověď požadavku — jinak dvojklik na stejném místě obrazovky odklepne
  // zakázku, která se ještě netiskla.
  const [lockUntil, setLockUntil] = useState(0);

  // `now` tiká samo — hodiny v hlavičce (formatPragueTime) i běhová logika
  // (pickHeroBlock/runProgress) běží ze stejné hodnoty; 15 s je dost časté
  // na hodiny a víc než dost časté na požadovaný strop 30 s pro `now`.
  //
  // Výchozí hodnota je záměrně `null`, ne `new Date()`: komponenta se renderuje
  // i na serveru a serverový čas se nikdy netrefí do klientského na milisekundu.
  // Šířka pruhu postupu by pak v serverovém a klientském HTML vyšla jinak a React
  // by hlásil hydration error. Skutečný čas nasadíme až po připojení v prohlížeči
  // — stejný vzor používá TimelineGrid (`useState<Date | null>(null)`).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const hero = now ? pickHeroBlock(blocks, viewMachine, now) : null;
  const queue = now ? todayQueue(blocks, viewMachine, now) : [];
  const partner = hero ? findSplitPartner(hero.block, blocks, viewMachine) : null;

  const kicker =
    hero?.reason === "running" ? "TEĎ BĚŽÍ"
    : hero?.reason === "overdue" ? "PŘETAHUJE"
    : hero ? "ZAČÍNÁ" : "";

  const kickerColor =
    hero?.reason === "overdue" ? "var(--warning)"
    : hero?.reason === "running" ? "var(--success)"
    : "var(--text-muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      {/* ── Hlavička ── */}
      <header style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}>
        <img src="/logo.png" alt="Integraf" style={{ height: 24, width: "auto", objectFit: "contain", flexShrink: 0 }} />
        <span style={{ fontSize: 17, fontWeight: 660, color: "var(--text)", flexShrink: 0 }}>
          {machineLabel(viewMachine)}
        </span>
        <TiskarMachineToggle
          machines={MACHINES}
          activeMachine={viewMachine}
          ownMachine={ownMachine ?? MACHINES[0]}
          onChange={onMachineChange}
        />
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 18, color: "var(--text)",
          fontVariantNumeric: "tabular-nums", flexShrink: 0,
        }}>
          {now ? formatPragueTime(now) : "--:--"}
        </span>
        <button style={HEADER_BTN} onClick={(e) => { if (e.button !== 0) return; onOpenSearch(); }}>
          🔍 Najít
        </button>
        <button
          style={{ ...HEADER_BTN, background: "var(--surface-3)", color: "var(--text)" }}
          onClick={(e) => { if (e.button !== 0) return; onOpenPlan(); }}
        >
          Celý plán →
        </button>
        <button style={HEADER_BTN} onClick={(e) => { if (e.button !== 0) return; onLogout(); }}>
          Odhlásit
        </button>
      </header>

      {/* ── Tělo ── */}
      <div style={{
        flex: 1, minHeight: 0,
        display: "grid", gridTemplateColumns: "1.45fr 1fr",
        gap: 18, padding: 18,
      }}>
        {/* Levý sloupec — velká karta */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          {hero && now ? (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase",
                color: kickerColor, fontWeight: 700, flexShrink: 0,
              }}>
                {kicker}
              </div>

              <div style={{
                flex: 1, minHeight: 0,
                display: "flex", flexDirection: "column", gap: 14,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 22,
                overflow: "hidden",
              }}>
                <div style={{
                  fontSize: 46, fontWeight: 700, letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums", lineHeight: 1, color: "var(--text)",
                }}>
                  {hero.block.orderNumber}
                </div>

                <div style={{
                  fontSize: 24, fontWeight: 600, color: "var(--text)", lineHeight: 1.2,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden", flexShrink: 0,
                }}>
                  {hero.block.description ?? ""}
                </div>

                {hero.block.specifikace && (
                  <div style={{
                    fontSize: 15, color: "var(--text-muted)", lineHeight: 1.4,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    overflow: "hidden", flexShrink: 0,
                  }}>
                    {hero.block.specifikace}
                  </div>
                )}

                <HeroChips block={hero.block} />

                <HeroTiming block={hero.block} reason={hero.reason} now={now} />

                {partner && (() => {
                  const { state, time } = getSplitChipState(partner);
                  return (
                    <div style={{
                      fontSize: 13, color: "var(--text-muted)",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>
                        {machineLabel(partner.machine)}
                      </span>
                      {state === "done"
                        ? `· hotovo ${formatPragueTime(time)}`
                        : `· čeká od ${formatPragueTime(time)}`}
                    </div>
                  );
                })()}

                <div style={{ marginTop: "auto" }}>
                  {onPrintComplete ? (
                    <PrintDoneButton
                      size={{ variant: "hero", height: 96, fontSize: 30 }}
                      isDone={hero.block.printCompletedAt != null}
                      completedAt={hero.block.printCompletedAt}
                      pending={pendingId === hero.block.id || Date.now() < lockUntil}
                      onToggle={() => {
                        const id = hero.block.id;
                        setPendingId(id);
                        const until = Date.now() + 800;
                        setLockUntil(until);
                        setTimeout(() => setLockUntil((cur) => (cur === until ? 0 : cur)), 800);
                        onPrintComplete(id, hero.block.printCompletedAt == null)
                          .finally(() => setPendingId((cur) => (cur === id ? null : cur)));
                      }}
                    />
                  ) : (
                    <div style={{
                      height: 96, borderRadius: 12,
                      display: "grid", placeItems: "center",
                      background: "var(--surface-2)", color: "var(--text-muted)",
                      fontSize: 14, textAlign: "center", padding: 12,
                    }}>
                      Odklepnout jde jen na vlastním stroji.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1, display: "grid", placeItems: "center",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, color: "var(--text-muted)", fontSize: 16, textAlign: "center", padding: 24,
            }}>
              {/* Dokud neběží čas (server render a první snímek v prohlížeči), nevíme,
                  co má být na kartě — hlásit „nic naplánováno" by v tu chvíli lhalo. */}
              {now ? "Na tomhle stroji nic naplánováno." : ""}
            </div>
          )}
        </div>

        {/* Pravý sloupec — fronta */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{
            fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase",
            color: "var(--text-muted)", fontWeight: 700, flexShrink: 0,
          }}>
            Dnes na {machineLabel(viewMachine)}
          </div>
          <MonitorQueue blocks={queue} heroId={hero?.block.id ?? null} onSelect={onSelectBlock} />
        </div>
      </div>
    </div>
  );
}

/** Výrobní a stavové štítky velké karty. */
function HeroChips({ block }: { block: Block }) {
  const chips: { label: string; tone: "brand" | "ok" | "wait" | "plain" | "danger" }[] = [];
  if (block.obalka) chips.push({ label: "OBÁLKA", tone: "brand" });
  if (block.vnitrky) chips.push({ label: "VNITŘKY", tone: "brand" });
  if (block.tiskoveArchy) chips.push({ label: block.tiskoveArchy, tone: "plain" });
  if (block.serie) chips.push({ label: block.serie, tone: "plain" });
  if (block.dataStatusLabel) chips.push({ label: block.dataStatusLabel, tone: block.dataOk ? "ok" : "wait" });
  // Připravenost materiálu = na skladě NEBO vydáno NEBO potvrzeno — stejná
  // logika jako BlockCard (jinak Monitor hlásí „čeká" na to, co je v plánu zelené).
  if (block.materialStatusLabel) {
    const materialReady = block.materialInStock || block.materialIssued || block.materialOk;
    chips.push({ label: block.materialStatusLabel, tone: materialReady ? "ok" : "wait" });
  }
  // Štítek se zobrazí za stejné podmínky jako v BlockCard (požadováno, má termín,
  // nebo je už odklepnuto) — samotné `pantoneRequired` je jen jedna ze tří cest tam.
  if (block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) {
    chips.push({ label: "PANTONE", tone: block.pantoneOk ? "ok" : "wait" });
  }
  // Nestandardní varianta zakázky (POZASTAVENO = výrobní stopka) — v plánu je
  // sytě červená, na Monitoru se dřív neukazovala vůbec (nález I5).
  if (block.blockVariant && block.blockVariant !== "STANDARD") {
    chips.push({
      label: VARIANT_CONFIG[block.blockVariant].label,
      tone: block.blockVariant === "POZASTAVENO" ? "danger" : "plain",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {chips.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          style={{
            fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
            borderRadius: 6, padding: "5px 10px", whiteSpace: "nowrap",
            background:
              c.tone === "ok"     ? "color-mix(in oklab, var(--success) 22%, transparent)"
              : c.tone === "wait"   ? "color-mix(in oklab, var(--warning) 22%, transparent)"
              : c.tone === "brand"  ? "var(--brand)"
              : c.tone === "danger" ? "var(--danger)"
              : "var(--surface-3)",
            color:
              c.tone === "ok"     ? "var(--success)"
              : c.tone === "wait"   ? "var(--warning)"
              : c.tone === "brand"  ? "var(--brand-contrast)"
              : c.tone === "danger" ? "white"
              : "var(--text)",
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** Časová osa běhu, nebo odpočet do startu u budoucí zakázky. */
function HeroTiming({ block, reason, now }: { block: Block; reason: "running" | "overdue" | "upcoming"; now: Date }) {
  const { percent, remainingMinutes } = runProgress(block, now);

  if (reason === "upcoming") {
    const minutesToStart = Math.ceil((new Date(block.startTime).getTime() - now.getTime()) / 60000);
    return (
      <div style={{ fontSize: 17, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        Začíná v {formatPragueTime(new Date(block.startTime))}
        <span style={{ color: "var(--text-muted)" }}> · za {formatMinutes(minutesToStart)}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 16, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums",
      }}>
        <span>{formatPragueTime(new Date(block.startTime))}</span>
        <span style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
          <span style={{
            display: "block", height: "100%", width: `${percent}%`,
            background: reason === "overdue" ? "var(--warning)" : "var(--success)",
          }} />
        </span>
        <span>{formatPragueTime(new Date(block.endTime))}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
        {remainingMinutes >= 0
          ? `Zbývá ${formatMinutes(remainingMinutes)}`
          : `Přetahuje o ${formatMinutes(-remainingMinutes)}`}
      </div>
    </div>
  );
}

/** 95 → „1 h 35 min", 40 → „40 min". */
function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
