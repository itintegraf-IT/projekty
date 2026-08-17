"use client";

import { useEffect, useMemo, useState } from "react";
import type { Block } from "@/app/_components/TimelineGrid";
import { pickHeroBlock, monitorQueue, runProgress, resolveStickyBlock, startDayLabel, resolveSelectedBlock, reasonForBlock, unfinishedFloorMs } from "@/lib/monitorView";
import { findSplitPartner, getSplitChipState } from "@/lib/splitHelpers";
import { PrintDoneButton } from "@/components/planner/PrintDoneButton";
import { TiskarMachineToggle } from "@/components/TiskarMachineToggle";
import { MonitorQueue } from "@/components/monitor/MonitorQueue";
import { MonitorChips } from "@/components/monitor/MonitorChips";
import { MonitorHeroTiming } from "@/components/monitor/MonitorHeroTiming";
import { machineLabel, MACHINES } from "@/lib/machines";
import { SPEC_HIGHLIGHT } from "@/lib/blockStyles";
import { formatPragueTime } from "@/lib/dateUtils";
import { FontScaleSwitch } from "@/components/planner/FontScaleSwitch";
import type { PlannerFontScale } from "@/lib/plannerTypography";
import { monitorTypeScale, MONITOR_HERO_BUTTON_HEIGHT, type MonitorTypeScale } from "@/lib/monitorTypography";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import type { CompanyDayClientRow } from "@/lib/printTimeClient";
import { shouldMarkDrift } from "@/lib/monitorDriftMark";

type Props = {
  blocks: Block[];
  viewMachine: string;
  ownMachine: string | null;
  /** Kalendář stroje pro rozejitý-čas detekci (`shouldMarkDrift`) — bez něj Monitor
   *  nepozná, že aplikace sama ví o bloku, jehož konec už nesedí na kalendář. */
  machineWeekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayClientRow[];
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  onOpenPlan: () => void;
  onOpenSearch: () => void;
  onMachineChange: (machine: string) => void;
  onLogout: () => void;
  /** Zakázka, kterou má Monitor vytáhnout na velkou kartu (klik ve vyhledávání). */
  focusBlockId?: number | null;
  /** Zavolá se, jakmile Monitor požadavek spotřebuje — jednorázový příkaz. */
  onFocusHandled?: () => void;
  /** Stupeň písma sdílený s plánem (localStorage, vlastnost obrazovky u stroje). */
  fontScale: PlannerFontScale;
  onFontScaleChange: (next: PlannerFontScale) => void;
};

function headerButtonStyle(ts: MonitorTypeScale) {
  return {
    padding: "8px 14px",
    fontSize: ts.headButton,
    borderRadius: 8,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    cursor: "pointer",
    font: "inherit",
    flexShrink: 0,
  } as const;
}

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
  machineWeekShifts, companyDays,
  onPrintComplete, onOpenPlan, onOpenSearch, onMachineChange, onLogout,
  focusBlockId, onFocusHandled,
  fontScale, onFontScaleChange,
}: Props) {
  const ts = useMemo(() => monitorTypeScale(fontScale), [fontScale]);
  const HEADER_BTN = useMemo(() => headerButtonStyle(ts), [ts]);
  // Vázané na konkrétní blok, ne na komponentu: po odklepnutí se hero karta
  // přepne na další zakázku ještě během požadavku a jeden sdílený boolean
  // by zašedil tlačítko, kterého se nikdo nedotkl.
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Krátké okno po libovolném odklepnutí, kdy je tlačítko HOTOVO zamčené i pro
  // NOVOU hero zakázku, která se sem optimisticky přepne dřív, než dorazí
  // odpověď požadavku — jinak dvojklik na stejném místě obrazovky odklepne
  // zakázku, která se ještě netiskla.
  const [lockUntil, setLockUntil] = useState(0);

  // Zakázka držená na kartě po odklepnutí — karta se sama nikdy nepřepne,
  // čeká na „Další →" nebo „Vrátit" (vědomé rozhodnutí, viz spec §2).
  const [stickyId, setStickyId] = useState<number | null>(null);
  // Zakázka, u které první kliknutí jen vyvolalo dotaz „opravdu?" — týká se
  // výhradně zakázek, které ještě nezačaly.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  // Vrátit je destruktivní a karta drží zakázku bez expirace — tiskař na další
  // směně by jinak jedním kliknutím rozdělal zakázku z minulé směny. Proto
  // na dvě doby. Držíme id, ne boolean: zastaralý časovač by jinak zhasl
  // dotaz, který mezitím otevřela jiná zakázka.
  const [confirmingRevertId, setConfirmingRevertId] = useState<number | null>(null);

  // Zakázka, kterou si tiskař ručně vytáhl z fronty. Přebíjí automatický výběr:
  // plán je optimální pořadí, ale u stroje se legitimně odchýlí (typicky když
  // na následující zakázku není materiál).
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Zakázky, které tiskař u tohoto stroje vědomě odsunul z karty. Bez omezení
  // by přetahující zakázka držela kartu donekonečna a jediná cesta dál by byla
  // odklepnout ji — tedy zalhat do evidence (`printCompletedAt` je podklad pro
  // reporty). `skippedIds` platí jen pro výběr hero karty (`pickHeroBlock`) —
  // `monitorQueue` o něm neví, takže zakázka ve frontě zůstává (v sekci
  // NEDODĚLÁNO, nebo výjimečně DNES/ZÍTRA, pokud tam podle startu patří —
  // viz `monitorQueue` v `monitorView.ts`), nikdy nezmizí docela.
  //
  // localStorage, ne server: je to vlastnost TÉHLE obrazovky u stroje, ne
  // uživatele. Kiosek se restartuje a bez uložení by po každém restartu
  // naskočila táž zakázka znovu.
  const [skippedIds, setSkippedIds] = useState<ReadonlySet<number>>(new Set());

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

  const liveHero = now ? pickHeroBlock(blocks, viewMachine, now, skippedIds) : null;
  const sticky = resolveStickyBlock(blocks, stickyId, viewMachine);
  const selected = resolveSelectedBlock(blocks, selectedId, viewMachine);

  // Priorita: ruční výběr → držení (odklepnuto, čeká na Další) → automatika.
  // Klik ve frontě je vědomá akce a přebije i probíhající držení — tiskař tak
  // může kdykoli přeskočit na jinou zakázku, aniž by musel nejdřív dát Další →.
  // Rozlišený tvar, ať TypeScript pozná, že `reason` má jen živá karta.
  const card = !now
    ? null
    : selected
    ? selected.printCompletedAt != null
      ? ({ kind: "completed", block: selected } as const)
      : ({ kind: "live", block: selected, reason: reasonForBlock(selected, now) } as const)
    : sticky
    ? ({ kind: "completed", block: sticky } as const)
    : liveHero
    ? ({ kind: "live", block: liveHero.block, reason: liveHero.reason } as const)
    : null;

  // Označení je jediná cesta zpět k doporučenému pořadí — schováme ho jen tehdy,
  // když karta sama nabízí „Další →" (tedy u odklepnuté zakázky na vlastním stroji).
  // Na cizím stroji se místo tlačítek vykreslí jen hláška, takže označení musí zůstat.
  const offersNext = !!onPrintComplete && card?.kind === "completed";
  const manualOverride =
    !!selected && card?.block.id === selected.id && !offersNext
    && selected.id !== liveHero?.block.id;

  // Držení přestalo platit (odklepnutí zrušil někdo jiný, blok zmizel) —
  // zahodíme id, ať se stav nedrží naprázdno.
  useEffect(() => {
    if (stickyId != null && !sticky) setStickyId(null);
    setConfirmingRevertId(null);
  }, [stickyId, sticky]);

  // Výběr přestal platit (zakázka zmizela z dat nebo se přesunula na jiný stroj).
  useEffect(() => {
    if (selectedId != null && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  // Přepnutí stroje ruší jak držení, tak rozdělané dotazy — karta patří jinam.
  useEffect(() => {
    setStickyId(null);
    setConfirmingId(null);
    setConfirmingRevertId(null);
    setSelectedId(null);
  }, [viewMachine]);

  const skipKey = `monitor-skipped:${viewMachine}`;

  // Čte se až po připojení v prohlížeči: komponenta se renderuje i na serveru,
  // kde localStorage není, a rozdílný první snímek by vyvolal hydration error.
  //
  // MUSÍ být deklarovaný ZA úklidovým efektem `[viewMachine]` výš (běží i při
  // mountu) a PŘED efektem `focusBlockId` níž — stejná past, jakou popisuje
  // komentář u něj.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(skipKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setSkippedIds(new Set(Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : []));
    } catch {
      // Poškozený nebo nedostupný localStorage nesmí shodit obrazovku u stroje.
      setSkippedIds(new Set());
    }
  }, [skipKey]);

  function skipBlock(id: number) {
    // Zápis do localStorage je vedlejší efekt, nesmí sedět uvnitř updateru
    // `setSkippedIds` — ten musí zůstat čistá funkce (StrictMode ho zavolá
    // dvakrát, se side-efektem uvnitř by dvakrát zapsal). `next` se proto
    // spočítá napřed a zápis proběhne AŽ PO `setSkippedIds`.
    //
    // Před přidáním nového id sadu prořízneme: `Block` řádky se v projektu
    // nikdy nemažou samy od sebe, takže bez úklidu by `monitor-skipped:<stroj>`
    // v localStorage rostl donekonečna. Zahodíme id bloků, které mezitím z
    // dat úplně zmizely (smazané), a id bloků pod `unfinishedFloorMs` — ty už
    // by stejně nikdy nebyly kandidátem na hero kartu ani na sekci NEDODĚLÁNO
    // (`pickHeroBlock`/`monitorQueue` je samy vylučují), takže si nezaslouží
    // trvalé místo v úložišti.
    const floorMs = now ? unfinishedFloorMs(now) : 0;
    const pruned = new Set(
      [...skippedIds].filter((sid) => {
        const b = blocks.find((x) => x.id === sid);
        return !!b && new Date(b.endTime).getTime() >= floorMs;
      })
    );
    const next = new Set(pruned);
    next.add(id);
    setSkippedIds(next);
    try {
      window.localStorage.setItem(skipKey, JSON.stringify([...next]));
    } catch {
      // Zápis smí selhat (plná kvóta, privátní režim) — přeskočení pak
      // platí jen do restartu. Lepší než spadnout.
    }
    setSelectedId(null);
  }

  // Jednorázový příkaz zvenčí: „dej tuhle zakázku na velkou kartu".
  //
  // MUSÍ být deklarovaný ZA efektem `[viewMachine]` výš. React spouští efekty
  // v pořadí deklarace a ten úklidový efekt běží I PŘI MOUNTU — dřív deklarovaný
  // focus by si tedy sám přepsal výběr na null, kdykoli hledání zároveň přepnulo
  // stroj (a při návratu z plánu na Monitor vždycky).
  //
  // Druhá podmínka je na straně volajícího: `setViewMachine` a `setMonitorFocusId`
  // musí padnout v TÉMŽE handleru, aby je React zbatchoval. Jinak by tenhle
  // render proběhl ještě se starým strojem, `resolveSelectedBlock` by blok odmítl
  // pro neshodu stroje a úklidový efekt `[selectedId, selected]` by výběr smazal.
  useEffect(() => {
    if (focusBlockId == null) return;
    setSelectedId(focusBlockId);
    setStickyId(null);
    setConfirmingId(null);
    setConfirmingRevertId(null);
    onFocusHandled?.();
  }, [focusBlockId, onFocusHandled]);

  const queue = now ? monitorQueue(blocks, viewMachine, now) : { overdue: [], today: [], tomorrow: [] };
  const partner = card ? findSplitPartner(card.block, blocks, viewMachine) : null;

  const kicker =
    card?.kind === "completed" ? "✓ ODKLEPNUTO"
    : card?.kind === "live" && card.reason === "running" ? "TEĎ BĚŽÍ"
    : card?.kind === "live" && card.reason === "overdue" ? "PŘETAHUJE"
    : card ? "ZAČÍNÁ" : "";

  const kickerColor =
    card?.kind === "live" && card.reason === "overdue" ? "var(--warning)"
    : card?.kind === "completed" || (card?.kind === "live" && card.reason === "running")
    ? "var(--success)"
    : "var(--text-muted)";

  // Popisek do potvrzovacího tlačítka: „ZÍTRA 6:00" / „13. 08. 6:00" / „V 6:00".
  const startLabelForConfirm = card && now
    ? (() => {
        const day = startDayLabel(card.block.startTime, now);
        const time = formatPragueTime(new Date(card.block.startTime));
        return day ? `${day.toUpperCase()} ${time}` : `V ${time}`;
      })()
    : "";

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
        <span style={{ fontSize: ts.headMachine, fontWeight: 660, color: "var(--text)", flexShrink: 0 }}>
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
          fontSize: ts.headClock, color: "var(--text)",
          fontVariantNumeric: "tabular-nums", flexShrink: 0,
        }}>
          {now ? formatPragueTime(now) : "--:--"}
        </span>
        {/* Týž přepínač a týž klíč v localStorage jako v plánu — je to jedno
            nastavení jedné obrazovky u stroje, ne dvě nezávislá. Tiskař si ho
            nastaví jednou a platí, ať kouká na Monitor nebo na celý plán. */}
        <FontScaleSwitch value={fontScale} onChange={onFontScaleChange} />
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
          {card && now ? (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: ts.kicker, letterSpacing: "0.16em", textTransform: "uppercase",
                color: kickerColor, fontWeight: 700, flexShrink: 0,
              }}>
                {kicker}
              </div>

              {manualOverride && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
                  fontSize: ts.heroNote, color: "var(--text-muted)",
                }}>
                  <span>vybráno ručně</span>
                  <button
                    onClick={(e) => { if (e.button !== 0) return; setSelectedId(null); }}
                    style={{
                      font: "inherit", fontSize: ts.heroNote,
                      padding: "3px 10px", borderRadius: 7,
                      background: "var(--surface-2)", border: "1px solid var(--border)",
                      color: "var(--text)", cursor: "pointer",
                    }}
                  >
                    zpět na doporučené
                  </button>
                </div>
              )}

              <div style={{
                flex: 1, minHeight: 0,
                display: "flex", flexDirection: "column", gap: 14,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 22,
                overflow: "hidden",
              }}>
                {/* Obsah je od tlačítek oddělený VLASTNÍM `flex: 1; minHeight: 0;
                    overflow: hidden` kontejnerem (17. 8. 2026, spolu s napojením
                    na stupně písma). Do té doby všechno leželo v jednom sloupci
                    a tlačítko drželo dole jen `marginTop: auto` — jakmile obsah
                    přerostl kartu, ořez `overflow: hidden` sebral TLAČÍTKO, ne
                    obsah. Zvětšení písma na XL je přesně ten případ. Teď se ořízne
                    obsah a tlačítko HOTOVO zůstane vidět VŽDY — je to jediná
                    cesta, kterou tiskař odklepne tisk (havárie 3. a 12. 8. 2026
                    měly týž tvar: rostoucí prvek proti pevné mezi). */}
                <div style={{
                  flex: 1, minHeight: 0, overflow: "hidden",
                  display: "flex", flexDirection: "column", gap: 14,
                }}>
                <div style={{
                  fontSize: ts.heroOrder, fontWeight: 700, letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums", lineHeight: 1, color: "var(--text)",
                }}>
                  {card.block.orderNumber}
                </div>

                <div style={{
                  fontSize: ts.heroDesc, fontWeight: 600, color: "var(--text)", lineHeight: 1.2,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden", flexShrink: 0,
                }}>
                  {card.block.description ?? ""}
                </div>

                {card.block.specifikace?.trim() && (
                  // Amber pás jako na kartě bloku v plánu (SpecBand, 8/2026) — specifikace
                  // je to, podle čeho tiskař u stroje seřizuje, a jako šedý text ji
                  // přehlédne. Barvy jsou záměrně stejné literály jako v plánu
                  // (SPEC_HIGHLIGHT), aby stejná informace vypadala na obou místech stejně;
                  // pás si nese vlastní pozadí, takže funguje ve světlém i tmavém režimu.
                  <div
                    title={card.block.specifikace}
                    style={{
                      background: SPEC_HIGHLIGHT.bg,
                      color: SPEC_HIGHLIGHT.text,
                      borderRadius: 7,
                      padding: "8px 12px",
                      fontSize: ts.heroSpec, fontWeight: 700, lineHeight: 1.35,
                      letterSpacing: "0.01em",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      overflow: "hidden", flexShrink: 0,
                    }}
                  >
                    {card.block.specifikace}
                  </div>
                )}

                <MonitorChips block={card.block} size="hero" ts={ts} />

                {card.kind === "completed" ? (
                  <div style={{ fontSize: ts.heroDone, fontWeight: 700, color: "var(--success)" }}>
                    ✓ Hotovo {card.block.printCompletedAt
                      ? formatPragueTime(new Date(card.block.printCompletedAt))
                      : ""}
                  </div>
                ) : (
                  <MonitorHeroTiming
                    block={card.block} reason={card.reason} now={now} ts={ts}
                    weekShifts={machineWeekShifts} companyDays={companyDays}
                  />
                )}

                {partner && (() => {
                  const { state, time } = getSplitChipState(partner);
                  // Táž past, jakou featura opravila o dvacet řádků výš u
                  // HeroTiming: do 13. 8. karta ukazovala jen dnešní/zítřejší
                  // bloky, takže čas bez data stačil. Teď na ní může ležet
                  // zakázka z minulého týdne a čas bez data by se četl jako
                  // dnešní stav druhého stroje.
                  const day = startDayLabel(time, now);
                  return (
                    <div style={{
                      fontSize: ts.heroPartner, color: "var(--text-muted)",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>
                        {machineLabel(partner.machine)}
                      </span>
                      {state === "done"
                        ? `· hotovo ${day ? `${day} ` : ""}${formatPragueTime(time)}`
                        : `· čeká od ${day ? `${day} ` : ""}${formatPragueTime(time)}`}
                    </div>
                  );
                })()}

                </div>

                {/* Tlačítka: `flexShrink: 0` a MIMO obsahový kontejner výš — viz
                    komentář u něj. Nikdy se nesmí vrátit dovnitř. */}
                <div style={{ flexShrink: 0 }}>
                  {!onPrintComplete ? (
                    <div style={{
                      height: MONITOR_HERO_BUTTON_HEIGHT, borderRadius: 12,
                      display: "grid", placeItems: "center",
                      background: "var(--surface-2)", color: "var(--text-muted)",
                      fontSize: ts.queueEmpty, textAlign: "center", padding: 12,
                    }}>
                      Odklepnout jde jen na vlastním stroji.
                    </div>
                  ) : card.kind === "completed" ? (
                    // Karta drží zakázku, dokud tiskař nerozhodne. Obě tlačítka jsou
                    // po dobu zámku neaktivní, aby je netrefil druhý klik rychlého
                    // dvojkliku na místě, kde do té chvíle bylo HOTOVO.
                    <div style={{ display: "flex", gap: 12, height: MONITOR_HERO_BUTTON_HEIGHT }}>
                      <button
                        onClick={(e) => {
                          if (e.button !== 0) return;
                          // Vrátit je destruktivní a karta drží zakázku bez expirace:
                          // první klik se jen zeptá, zámek se nastaví až u druhého
                          // (skutečného) kliknutí — jinak by tiskař nemohl potvrdit
                          // dřív, než by mu vlastní zámek zablokoval tlačítko.
                          const id = card.block.id;
                          if (confirmingRevertId !== id) {
                            setConfirmingRevertId(id);
                            setTimeout(
                              () => setConfirmingRevertId((cur) => (cur === id ? null : cur)),
                              5000
                            );
                            return;
                          }
                          setConfirmingRevertId(null);
                          setPendingId(id);
                          // stickyId nemažeme ručně: jakmile zakázka v datech přestane
                          // být odklepnutá, resolveStickyBlock vrátí null a úklidový
                          // efekt držení pustí. Když požadavek selže, karta zůstane.
                          const until = Date.now() + 800;
                          setLockUntil(until);
                          setTimeout(() => setLockUntil((cur) => (cur === until ? 0 : cur)), 800);
                          onPrintComplete(id, false)
                            .finally(() => setPendingId((cur) => (cur === id ? null : cur)));
                        }}
                        disabled={pendingId === card.block.id || Date.now() < lockUntil}
                        style={{
                          flex: 1, borderRadius: 12,
                          border: confirmingRevertId === card.block.id ? "none" : "1px solid var(--border)",
                          background: confirmingRevertId === card.block.id ? "var(--warning)" : "var(--surface-3)",
                          color: confirmingRevertId === card.block.id ? "var(--brand-contrast)" : "var(--text)",
                          font: "inherit",
                          fontSize: confirmingRevertId === card.block.id ? ts.btnRevertConfirm : ts.btnRevert,
                          fontWeight: 700, cursor: "pointer",
                        }}
                      >
                        {confirmingRevertId === card.block.id ? "OPRAVDU VRÁTIT?" : "Vrátit"}
                      </button>
                      <button
                        onClick={(e) => {
                          if (e.button !== 0) return;
                          setStickyId(null);
                          setSelectedId(null);
                          const until = Date.now() + 800;
                          setLockUntil(until);
                          setTimeout(() => setLockUntil((cur) => (cur === until ? 0 : cur)), 800);
                        }}
                        disabled={Date.now() < lockUntil}
                        style={{
                          flex: 2, borderRadius: 12, border: "none",
                          background: "var(--brand)", color: "var(--brand-contrast)",
                          font: "inherit", fontSize: ts.btnNext, fontWeight: 750,
                          letterSpacing: "0.04em", cursor: "pointer",
                        }}
                      >
                        Další →
                      </button>
                    </div>
                  ) : (() => {
                    const doneButton = (
                      <PrintDoneButton
                        size={{ variant: "hero", height: MONITOR_HERO_BUTTON_HEIGHT, fontSize: ts.btnDone }}
                        isDone={false}
                        completedAt={null}
                        pending={pendingId === card.block.id || Date.now() < lockUntil}
                        confirmLabel={
                          card.reason === "upcoming" && confirmingId === card.block.id
                            ? `ZAČÍNÁ ${startLabelForConfirm} — POTVRDIT`
                            : undefined
                        }
                        onToggle={() => {
                          const id = card.block.id;
                          // Budoucí zakázka na dvě doby: první kliknutí se jen zeptá.
                          if (card.reason === "upcoming" && confirmingId !== id) {
                            setConfirmingId(id);
                            setTimeout(
                              () => setConfirmingId((cur) => (cur === id ? null : cur)),
                              5000
                            );
                            return;
                          }
                          setConfirmingId(null);
                          setPendingId(id);
                          // Musí být synchronně, ne v .then(): PlannerPage označí
                          // zakázku za odklepnutou optimisticky ještě před odpovědí
                          // serveru, takže by karta do té doby ukazovala cizí zakázku.
                          setStickyId(id);
                          const until = Date.now() + 800;
                          setLockUntil(until);
                          setTimeout(() => setLockUntil((cur) => (cur === until ? 0 : cur)), 800);
                          onPrintComplete(id, true)
                            .finally(() => setPendingId((cur) => (cur === id ? null : cur)));
                        }}
                      />
                    );

                    // „Přeskočit →" jen u přetahující zakázky. U běžící ani budoucí
                    // nedává smysl — ta se odsouvat nepotřebuje, karta na ní nedrží.
                    if (card.reason !== "overdue") return doneButton;

                    return (
                      <div style={{ display: "flex", gap: 12, height: MONITOR_HERO_BUTTON_HEIGHT }}>
                        {/* Obalující div, ne PrintDoneButton napřímo: ten má vlastní
                            `flexShrink: 0` a bez `flex: 2` na tomhle divu by v outer
                            flexu nezabral dvoutřetinový podíl vedle „Přeskočit →" — jen
                            tolik místa, kolik potřebuje sám (viz PrintDoneButton.tsx).
                            Šířku button uvnitř dostane sám, `width: 100%` má ve svém
                            stylu (varianta `hero`) — vyplní přesně tenhle div. */}
                        <div style={{ flex: 2, minWidth: 0, display: "flex" }}>
                          {doneButton}
                        </div>
                        <button
                          onClick={(e) => { if (e.button !== 0) return; skipBlock(card.block.id); }}
                          style={{
                            flex: 1, borderRadius: 12,
                            border: "1px solid var(--border)",
                            background: "var(--surface-3)", color: "var(--text)",
                            font: "inherit", fontSize: ts.btnSkip, fontWeight: 700, cursor: "pointer",
                          }}
                        >
                          Přeskočit →
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1, display: "grid", placeItems: "center",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, color: "var(--text-muted)", fontSize: ts.heroEmpty, textAlign: "center", padding: 24,
            }}>
              {/* Dokud neběží čas (server render a první snímek v prohlížeči), nevíme,
                  co má být na kartě — hlásit „nic naplánováno" by v tu chvíli lhalo. */}
              {!now
                ? ""
                : queue.overdue.length > 0
                ? "Na dnešek nic naplánováno. Vpravo čekají nedodělané zakázky."
                : "Na tomhle stroji nic naplánováno."}
            </div>
          )}
        </div>

        {/* Pravý sloupec — fronta */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{
            fontSize: ts.sectionTitle, letterSpacing: "0.16em", textTransform: "uppercase",
            color: "var(--text-muted)", fontWeight: 700, flexShrink: 0,
          }}>
            Fronta na {machineLabel(viewMachine)}
          </div>
          <MonitorQueue
            overdue={queue.overdue}
            today={queue.today}
            tomorrow={queue.tomorrow}
            heroId={card?.block.id ?? null}
            onSelect={(block) => setSelectedId(block.id)}
            ts={ts}
            now={now ?? new Date(0)}
            weekShifts={machineWeekShifts}
            companyDays={companyDays}
          />
        </div>
      </div>
    </div>
  );
}
