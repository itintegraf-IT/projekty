"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { formatPragueTime, formatPragueDateTimeWithWeekday } from "@/lib/dateUtils";
import { MonitorChips } from "@/components/monitor/MonitorChips";
import { MonitorDriftNote } from "@/components/monitor/MonitorDriftNote";
import { SPEC_HIGHLIGHT, BLOCK_STYLES } from "@/lib/blockStyles";
import type { MonitorTypeScale } from "@/lib/monitorTypography";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import type { CompanyDayClientRow } from "@/lib/printTimeClient";
import { shouldMarkDrift } from "@/lib/monitorDriftMark";

type Props = {
  overdue: Block[];
  today: Block[];
  tomorrow: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
  ts: MonitorTypeScale;
  /** Pro rozejitý-čas značku (`shouldMarkDrift`) — kalendář a „teď", stejné
   *  jako u velké karty. Když `now` ještě neběží (první render), fronty
   *  jsou prázdné (`MonitorView`), takže se nepoužije. */
  now: Date;
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayClientRow[];
};

/**
 * Pravý sloupec Monitoru — zakázky na stroji: nedodělané z minulých dnů
 * (sekce NEDODĚLÁNO, zúženým řádkem, všechny bez stropu), dnešek a zítřek.
 * Dnes/Zítra nesou totéž, co velká karta: číslo, popis, čas, amber pás se
 * specifikací a výrobní i stavové chipy. Odklepnuté jsou ztlumené se zeleným
 * háčkem (včetně pásu), zakázka na velké kartě zvýrazněná. Kliknutí ji
 * vytáhne na velkou kartu (tiskař tím přebíjí pořadí od plánovače).
 */
export function MonitorQueue({ overdue, today, tomorrow, heroId, onSelect, ts, now, weekShifts, companyDays }: Props) {
  if (overdue.length === 0 && today.length === 0 && tomorrow.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: ts.queueEmpty, padding: "12px 4px" }}>
        Na tomhle stroji není dnes ani zítra nic naplánováno.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
      {/* NEDODĚLÁNO jde NAHORU: fronta se pak čte chronologicky shora dolů. */}
      <QueueSection
        title="Nedoděláno"
        blocks={overdue}
        heroId={heroId}
        onSelect={onSelect}
        ts={ts}
        now={now}
        weekShifts={weekShifts}
        companyDays={companyDays}
        tone="warning"
        showDate
        compact
      />
      <QueueSection title="Dnes" blocks={today} heroId={heroId} onSelect={onSelect} ts={ts} now={now} weekShifts={weekShifts} companyDays={companyDays} />
      <QueueSection title="Zítra" blocks={tomorrow} heroId={heroId} onSelect={onSelect} ts={ts} now={now} weekShifts={weekShifts} companyDays={companyDays} />
    </div>
  );
}

function QueueSection({
  title, blocks, heroId, onSelect, ts, now, weekShifts, companyDays, tone = "muted", showDate = false, compact = false,
}: {
  title: string;
  blocks: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
  ts: MonitorTypeScale;
  now: Date;
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayClientRow[];
  /** `warning` odliší nedodělané od běžné fronty — jediný barevný rozdíl. */
  tone?: "muted" | "warning";
  /** Řádek ukáže i den, ne jen čas. Povinné u zakázek z minulých dnů. */
  showDate?: boolean;
  /** Zúžený řádek: jen číslo, popis a čas. Bez pásu specifikace a bez chipů.
   *  Sekce NEDODĚLÁNO umí mít i deset položek (ostrá data 12. 8. 2026: XL 106
   *  jich má devět) a v plném tvaru by zatlačila nadpis „DNES" pod okraj
   *  obrazovky. Detaily tiskař dostane kliknutím — vyjede velká karta. */
  compact?: boolean;
}) {
  if (blocks.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      <div style={{
        fontSize: ts.sectionTitle, letterSpacing: "0.16em", textTransform: "uppercase",
        color: tone === "warning" ? "var(--warning)" : "var(--text-muted)", fontWeight: 700,
      }}>
        {title}
      </div>
      {blocks.map((b) => {
        // Údržba není zakázka: nedá se odklepnout ani vytáhnout na velkou kartu
        // (`resolveSelectedBlock` ji odmítá), takže dostane vlastní, neklikatelný
        // řádek. Do sekce NEDODĚLÁNO (`compact`) se nikdy nedostane —
        // `monitorQueue` ji tam pouštět nesmí.
        if (b.type === "UDRZBA") return <MaintenanceRow key={b.id} block={b} ts={ts} />;

        const isDone = b.printCompletedAt != null;
        const isHero = b.id === heroId;
        // Blok, o kterém aplikace sama ví, že nesedí na kalendář — shouldMarkDrift
        // vrací false u hotových bloků samo (blockCalendarDrift ignoruje
        // printCompletedAt), takže se s `isDone` nijak nekříží.
        const drift = shouldMarkDrift(b, weekShifts, companyDays, now);
        return (
          <button
            key={b.id}
            onClick={(e) => { if (e.button !== 0) return; onSelect(b); }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: compact ? 0 : 7,
              padding: compact ? "7px 12px" : "10px 12px",
              borderRadius: 10,
              textAlign: "left",
              font: "inherit",
              cursor: "pointer",
              background: isHero ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--surface)",
              border: `1px solid ${isHero ? "var(--success)" : "var(--border)"}`,
              color: "var(--text)",
              // Ztlumení se vztahuje i na amber pás. Hotová zakázka nemá u stroje
              // křičet — jinak by přebila tu, která se právě tiskne.
              opacity: isDone ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700, fontVariantNumeric: "tabular-nums",
                fontSize: compact ? ts.queueOrderCompact : ts.queueOrder, flexShrink: 0,
                color: isDone ? "var(--success)" : "var(--text)",
              }}>
                {isDone ? "✓ " : ""}{b.orderNumber}
              </span>
              <span style={{
                flex: 1, minWidth: 0,
                color: "var(--text-muted)", fontSize: compact ? ts.queueDescCompact : ts.queueDesc,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {b.description ?? ""}
              </span>
              {/* U nedodělaných musí být vidět DEN, jinak řádek vypadá jako dnešní
                  zakázka. Den v týdnu tam patří — tiskař myslí ve směnách, ne
                  v datech. `formatPragueDateTimeWithWeekday` dá „pá 9. 8. 22:00". */}
              <span style={{
                flexShrink: 0,
                color: "var(--text-muted)", fontSize: compact ? ts.queueTimeCompact : ts.queueTime,
                fontVariantNumeric: "tabular-nums",
              }}>
                {showDate
                  ? formatPragueDateTimeWithWeekday(new Date(b.startTime))
                  : formatPragueTime(new Date(b.startTime))}
              </span>
            </span>

            <MonitorDriftNote show={drift} size="queue" ts={ts} compact={compact} />

            {!compact && b.specifikace?.trim() && (
              // Amber pás jako na kartě bloku v plánu i na velké kartě Monitoru.
              // Barvy jsou záměrně stejné literály (SPEC_HIGHLIGHT), aby stejná
              // informace vypadala všude stejně; pás si nese vlastní pozadí, takže
              // funguje ve světlém i tmavém motivu.
              <span
                title={b.specifikace}
                style={{
                  background: SPEC_HIGHLIGHT.bg,
                  color: SPEC_HIGHLIGHT.text,
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: ts.queueSpec, fontWeight: 700, lineHeight: 1.3,
                  letterSpacing: "0.01em",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {b.specifikace}
              </span>
            )}

            {!compact && <MonitorChips block={b} size="queue" ts={ts} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Řádek neproduktivní operace ve frontě — údržba, oprava, servisní odstávka
 * stroje (17. 8. 2026, prosba tiskařů). Stroj v ten čas stojí a tiskař u něj
 * do té doby viděl jen nevysvětlenou díru mezi zakázkami.
 *
 * Není to `<button>` záměrně: velká karta patří zakázkám, `resolveSelectedBlock`
 * údržbu odmítá a klik by tedy neudělal vůbec nic. Mrtvé tlačítko u stroje je
 * horší než žádné.
 *
 * BAREVNÁ PAST: údržba je v plánu ZELENÁ (`BLOCK_STYLES.UDRZBA`), jenže zelená
 * v Monitoru znamená „odklepnuto" (✓ háček u zakázky) a zelený rámeček „tahle
 * je právě na velké kartě". Zelený řádek by tedy tiskaři lhal hned dvakrát.
 * Z barvy proto zůstává JEN levý proužek — vazbu na plán udrží, význam
 * nepřepíše. Kdo sem přidá zelený text nebo rámeček, tu past otevře zpátky.
 */
function MaintenanceRow({ block, ts }: { block: Block; ts: MonitorTypeScale }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 3,
        padding: "8px 12px 8px 10px",
        borderRadius: 10,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${BLOCK_STYLES.UDRZBA.accentBar}`,
        color: "var(--text-muted)",
        flexShrink: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{
          fontSize: ts.queueMaintLabel, fontWeight: 700, letterSpacing: "0.14em",
          textTransform: "uppercase", flexShrink: 0,
        }}>
          🔧 Údržba
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: ts.queueMaintText, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {formatPragueTime(new Date(block.startTime))}–{formatPragueTime(new Date(block.endTime))}
        </span>
      </span>
      {/* `orderNumber` je u údržby „Název / označení" (povinné pole builderu,
          typicky „Čištění hlavy"), `description` volitelný popis. */}
      <span style={{
        fontSize: ts.queueMaintText, color: "var(--text)", fontWeight: 600,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {block.orderNumber}
        {block.description?.trim() && (
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {block.description}</span>
        )}
      </span>
    </div>
  );
}
