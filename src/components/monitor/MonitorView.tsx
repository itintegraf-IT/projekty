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

type Props = {
  blocks: Block[];
  viewMachine: string;
  ownMachine: string | null;
  now: Date;
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
 * Komponenta nic nenačítá ani netiká — bloky i `now` dostává z PlannerPage,
 * která je už drží a udržuje aktuální přes SSE.
 */
export function MonitorView({
  blocks, viewMachine, ownMachine, now,
  onPrintComplete, onOpenPlan, onOpenSearch, onMachineChange, onSelectBlock, onLogout,
}: Props) {
  const [pending, setPending] = useState(false);

  // Hodiny v hlavičce si Monitor vede sám — je to čistě zobrazovací věc
  // a PlannerPage žádný takový stav nemá, nemá smysl mu ho přidávat.
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const hero = pickHeroBlock(blocks, viewMachine, now);
  const queue = todayQueue(blocks, viewMachine, now);
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
          {clock}
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
          {hero ? (
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
              }}>
                <div style={{
                  fontSize: 46, fontWeight: 700, letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums", lineHeight: 1, color: "var(--text)",
                }}>
                  {hero.block.orderNumber}
                </div>

                <div style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", lineHeight: 1.2 }}>
                  {hero.block.description ?? ""}
                </div>

                {hero.block.specifikace && (
                  <div style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.4 }}>
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
                      pending={pending}
                      onToggle={() => {
                        setPending(true);
                        onPrintComplete(hero.block.id, hero.block.printCompletedAt == null)
                          .finally(() => setPending(false));
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
              Na tomhle stroji nic naplánováno.
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
  const chips: { label: string; tone: "brand" | "ok" | "wait" | "plain" }[] = [];
  if (block.obalka) chips.push({ label: "OBÁLKA", tone: "brand" });
  if (block.vnitrky) chips.push({ label: "VNITŘKY", tone: "brand" });
  if (block.tiskoveArchy) chips.push({ label: block.tiskoveArchy, tone: "plain" });
  if (block.serie) chips.push({ label: block.serie, tone: "plain" });
  if (block.dataStatusLabel) chips.push({ label: block.dataStatusLabel, tone: block.dataOk ? "ok" : "wait" });
  if (block.materialStatusLabel) chips.push({ label: block.materialStatusLabel, tone: block.materialOk ? "ok" : "wait" });
  if (block.pantoneRequired) chips.push({ label: "PANTONE", tone: block.pantoneOk ? "ok" : "wait" });

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
              c.tone === "ok"    ? "color-mix(in oklab, var(--success) 22%, transparent)"
              : c.tone === "wait"  ? "color-mix(in oklab, var(--warning) 22%, transparent)"
              : c.tone === "brand" ? "color-mix(in oklab, var(--brand) 22%, transparent)"
              : "var(--surface-3)",
            color:
              c.tone === "ok"    ? "var(--success)"
              : c.tone === "wait"  ? "var(--warning)"
              : c.tone === "brand" ? "var(--brand)"
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
