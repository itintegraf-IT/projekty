"use client";

import React, { useState } from "react";
import { machineLabel } from "@/lib/machines";
import { reportTypeScale, reportGlyph, reportRadius } from "@/lib/reportTokens";
import type { BlockRef, HealthData } from "./useHealthData";
import IntegrityRow from "./IntegrityRow";
import CheckExplainer from "./CheckExplainer";

interface HealthPanelProps {
  data: HealthData | null;
  loading: boolean;
  error: string | null;
  /** Celkový počet nálezů (z useHealthData). */
  total: number;
  /** Kolik z 5 kontrol má nález (z useHealthData). */
  badChecks: number;
  /** Kolik z 5 kontrol se nepodařilo spočítat (z useHealthData). */
  uncomputed: number;
  /** Znovu spustí kontroly — aktualizuje panel i odznak v záhlaví. */
  onRefresh: () => void;
}

/**
 * Odstíny podle plánovače (`blockStyles.ts`), ne vlastní sada: údržba tu dřív
 * byla ČERVENÁ, zatímco v plánu je zelená — týž typ bloku měl dvě barvy podle
 * toho, na kterou obrazovku se člověk díval, a červená jinde v aplikaci
 * znamená problém. Bílý text na sytém podkladu navíc dával v tmavém režimu
 * 3,15–3,43:1, tedy pod AA; pilulka s 22% tónem to řeší v obou režimech.
 */
const TYPE_TONE: Record<string, string> = {
  ZAKAZKA: "var(--type-zakazka)",
  REZERVACE: "var(--type-rezervace)",
  UDRZBA: "var(--type-udrzba)",
};
const TYPE_LABEL: Record<string, string> = { ZAKAZKA: "ZAKÁZKA", REZERVACE: "REZERVACE", UDRZBA: "ÚDRŽBA" };

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
function jumpHref(blockId: number): string {
  return `/?highlight=${blockId}`;
}

function Chip({ type }: { type: string }) {
  return (
    <span style={{
      fontSize: reportTypeScale.xs, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: reportRadius.sm,
      color: TYPE_TONE[type] ?? "var(--text-muted)",
      background: TYPE_TONE[type]
        ? `color-mix(in oklab, ${TYPE_TONE[type]} 22%, transparent)`
        : "var(--surface-3)",
    }}>
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}
function Jump({ id }: { id: number }) {
  return <a href={jumpHref(id)} style={{ color: "var(--brand-text)", textDecoration: "none", fontSize: reportTypeScale.md, fontWeight: 600, whiteSpace: "nowrap" }}>Otevřít v plánu →</a>;
}

function Card({ title, subtitle, icon, count, error, copyKey, children }: {
  title: string; subtitle: string; icon: string; count: number | null; error?: string;
  copyKey: string; children?: React.ReactNode;
}) {
  // Výchozí rozbalení se POČÍTÁ tady, ne u volajícího: bylo to pětkrát opsané a
  // musí to sedět s `uncomputed` níž. Otevřít se musí i karta, která má nález,
  // i ta, která se nespočetla — u druhé je jinak důvod schovaný za klikem.
  const [open, setOpen] = useState((count ?? 1) > 0 || error != null);
  // Predikát MUSÍ být týž jako v `summarizeHealth` — kontrola se spočteným číslem,
  // ale s `error`, je taky nespočtená (server ten stav vyrábí, když selže jen dílčí
  // kontrola uvnitř rozpadu). Bez druhé podmínky by karta svítila zeleným „✓ 0",
  // zatímco souhrn nahoře hlásí „1 kontrola nespočtena" — a uživatel by musel
  // naklikat všech pět karet, aby zjistil kterou.
  const uncomputed = count === null || error != null;
  const bad = (count ?? 0) > 0;
  // Hrana je 3px tvar nesoucí stav, takže spadá pod WCAG 1.4.11 (3 : 1 vůči
  // podkladu) — ne pod pravidla pro výplně. `--warning` na kartě dává 1,86 : 1
  // a ztlumená zelená 2,10 : 1; obojí je pod prahem. Stavová čtveřice je
  // změřená (≥ 5 : 1), takže hranu unese bez výjimky.
  const edge = uncomputed
    ? "var(--status-warn)"
    : bad
      ? "var(--status-bad)"
      : "var(--status-ok)";
  const pillColor = uncomputed ? "var(--warning-text)" : bad ? "var(--status-bad)" : "var(--status-ok)";
  const pillBg = uncomputed
    ? "color-mix(in oklab, var(--warning) 20%, transparent)"
    : bad
      ? "color-mix(in oklab, var(--danger) 20%, transparent)"
      : "color-mix(in oklab, var(--success) 18%, transparent)";
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderLeft: `3px solid ${edge}`, borderRadius: reportRadius.lg, overflow: "hidden",
    }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", cursor: "pointer", userSelect: "none" }}>
        <div style={{ width: 32, height: 32, borderRadius: reportRadius.md, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: reportGlyph.sm, background: "var(--surface-2)" }}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: reportTypeScale.lg }}>{title}</div>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{
            fontSize: reportTypeScale.base, fontWeight: 800, padding: "4px 11px", borderRadius: reportRadius.pill, fontVariantNumeric: "tabular-nums",
            color: pillColor, background: pillBg,
          }}>{
            // Tři stavy, ale „nespočteno" má dvě podoby: kontrola vůbec neproběhla
            // (count === null), nebo proběhla jen zčásti — číslo pak platí, ale není úplné.
            uncomputed ? (count === null ? "nespočteno" : `${count} · neúplné`) : bad ? count : "✓ 0"
          }</span>
          <span style={{ color: "var(--text-muted)", fontSize: reportTypeScale.base, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 15px 15px" }}>
          {uncomputed && (
            <div style={{ fontSize: reportTypeScale.base, color: "var(--warning-text)", marginBottom: 8 }}>
              Kontrola se nespočetla: {error ?? "důvod neznámý"}
            </div>
          )}
          <CheckExplainer copyKey={copyKey} />
          {/* Když kontrola neproběhla vůbec, data NEVYKRESLOVAT — prázdná tabulka
              nebo řádky s nulami vypadají jako „bez nálezu", což je přesně to tiché
              selhání, které má panel odhalovat. Částečný výsledek (count != null)
              smysl má, ten se ukáže. */}
          {count === null
            ? <div style={{ fontSize: reportTypeScale.base, color: "var(--text-muted)", marginTop: 8 }}>Data nejsou k dispozici — kontrola neproběhla.</div>
            : children}
        </div>
      )}
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", fontSize: reportTypeScale.xs, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, padding: "9px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" };
const TD: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: reportTypeScale.md };
function TableWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: reportRadius.lg }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>{children}</table></div>;
}

/**
 * Přiznaný strop. Server ořezává položky na 50, `count` nese skutečný počet —
 * bez téhle věty karta u 200 driftujících bloků ukáže číslo 200 a tabulku o 50
 * řádcích, aniž by řekla proč. U Driftu to na produkci reálně nastane.
 */
function Truncated({ count, shown }: { count: number | null; shown: number }) {
  if (count === null || count <= shown) return null;
  return (
    <div style={{ marginTop: 6, fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
      Zobrazeno {shown} z {count} nálezů.
    </div>
  );
}
function BlockCell({ r }: { r: BlockRef }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Chip type={r.type} />
      <span style={{ fontWeight: 600 }}>{r.orderNumber || `#${r.id}`}</span>
      <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(r.startTime)}–{fmtDateTime(r.endTime)}</span>
    </div>
  );
}

export default function HealthPanel({ data, loading, error, total, badChecks, uncomputed, onRefresh }: HealthPanelProps) {
  const sectionLabel: React.CSSProperties = { fontSize: reportTypeScale.base, color: "var(--brand-text)", fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 12 };
  const refreshBtn = (
    <button onClick={onRefresh} disabled={loading} style={{ background: "var(--brand)", color: "var(--brand-contrast)", border: "1px solid var(--brand)", borderRadius: reportRadius.md, padding: "9px 15px", fontSize: reportTypeScale.md, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1, whiteSpace: "nowrap" }}>
      ↻ {loading ? "Kontroluji…" : "Překontrolovat teď"}
    </button>
  );

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionLabel}>Kontrolní panel</div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: reportRadius.md, background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", color: "var(--status-bad)", fontSize: reportTypeScale.md }}>
          Chyba kontroly: {error} <button onClick={onRefresh} style={{ marginLeft: 8, background: "none", border: "none", color: "var(--brand-text)", cursor: "pointer", fontWeight: 600 }}>Zkusit znovu</button>
        </div>
      )}

      {!error && data && (
        <>
          {/* Souhrnný proužek */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: "var(--surface)", border: `1px solid ${total > 0 ? "color-mix(in oklab, var(--danger) 45%, var(--border))" : uncomputed > 0 ? "color-mix(in oklab, var(--warning) 45%, var(--border))" : "color-mix(in oklab, var(--success) 40%, var(--border))"}`, borderRadius: reportRadius.lg, padding: "16px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 250 }}>
              {/* Ikona MUSÍ žloutnout spolu s rámečkem a nadpisem — zelené ✓ vedle
                  nadpisu „Bez nálezu (neúplně)" tvrdí přesně to, co panel odhaluje. */}
              <div style={{ width: 42, height: 42, borderRadius: reportRadius.lg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: reportGlyph.lg, background: total > 0 ? "color-mix(in oklab, var(--danger) 22%, transparent)" : uncomputed > 0 ? "color-mix(in oklab, var(--warning) 22%, transparent)" : "color-mix(in oklab, var(--success) 20%, transparent)" }}>{total > 0 ? "⚠️" : uncomputed > 0 ? "⚠" : "✓"}</div>
              <div>
                <div style={{ fontSize: reportTypeScale.hero, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: total > 0 ? "var(--status-bad)" : uncomputed > 0 ? "var(--warning-text)" : "var(--status-ok)" }}>
                  {total > 0 ? `${total} ${total === 1 ? "problém" : total < 5 ? "problémy" : "problémů"}` : uncomputed > 0 ? "Bez nálezu (neúplně)" : "Vše v pořádku"}
                </div>
                <div style={{ fontSize: reportTypeScale.base, color: "var(--text-muted)", marginTop: 3 }}>
                  {total > 0 ? `v ${badChecks} z 5 kontrol · ` : uncomputed > 0 ? "5 kontrol · " : "5 kontrol bez nálezu · "}
                  {uncomputed > 0 ? `${uncomputed} ${uncomputed === 1 ? "kontrola nespočtena" : uncomputed < 5 ? "kontroly nespočteny" : "kontrol nespočteno"} · ` : ""}
                  kontrola {fmtDateTime(data.checkedAt)}
                </div>
              </div>
            </div>
            {refreshBtn}
          </div>

          {/* Karty */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* 1. Překryvy */}
            <Card icon="🔀" title="Překryvy bloků" subtitle="Dva bloky na stejném stroji ve stejný čas — jen budoucí." copyKey="overlaps" count={data.checks.overlaps.count} error={data.checks.overlaps.error}>
              <TableWrap>
                <thead><tr><th style={TH}>Stroj</th><th style={TH}>Blok A</th><th style={TH}>Blok B</th><th style={TH}>Překryv</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.overlaps.items.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...TD, fontWeight: 700, fontSize: reportTypeScale.base }}>{machineLabel(p.machine)}</td>
                      <td style={TD}><BlockCell r={p.a} /></td>
                      <td style={TD}><BlockCell r={p.b} /></td>
                      <td style={{ ...TD, color: "var(--warning-text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p.overlapMinutes} m</td>
                      <td style={TD}><Jump id={p.a.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Truncated count={data.checks.overlaps.count} shown={data.checks.overlaps.items.length} />
            </Card>

            {/* 2. Drift */}
            <Card icon="🕒" title="Drift konce bloku" subtitle="Uložený konec nesedí na aktuální pracovní kalendář." copyKey="drift" count={data.checks.drift.count} error={data.checks.drift.error}>
              <TableWrap>
                <thead><tr><th style={TH}>Zakázka</th><th style={TH}>Stroj</th><th style={TH}>Uložený konec</th><th style={TH}>Přepočítaný</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.drift.items.map((d) => (
                    <tr key={d.id}>
                      <td style={TD}><span style={{ fontWeight: 600 }}>{d.orderNumber || `#${d.id}`}</span><div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>start {fmtDateTime(d.startTime)}</div></td>
                      <td style={{ ...TD, fontWeight: 700, fontSize: reportTypeScale.base }}>{machineLabel(d.machine)}</td>
                      <td style={{ ...TD, color: "var(--text-muted)", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(d.storedEnd)}</td>
                      <td style={{ ...TD, color: "var(--warning-text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{d.expectedEnd ? fmtDateTime(d.expectedEnd) : "nelze spočítat"}</td>
                      <td style={TD}><Jump id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Truncated count={data.checks.drift.count} shown={data.checks.drift.items.length} />
            </Card>

            {/* 3. Mimo provoz */}
            <Card icon="🚫" title="Bloky mimo provoz stroje" subtitle="Zakázka začíná, když stroj nejede a není to vědomý bypass." copyKey="outsideHours" count={data.checks.outsideHours.count} error={data.checks.outsideHours.error}>
              <TableWrap>
                <thead><tr><th style={TH}>Zakázka</th><th style={TH}>Stroj</th><th style={TH}>Začátek</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.outsideHours.items.map((d) => (
                    <tr key={d.id}>
                      <td style={{ ...TD, fontWeight: 600 }}>{d.orderNumber || `#${d.id}`}</td>
                      <td style={{ ...TD, fontWeight: 700, fontSize: reportTypeScale.base }}>{machineLabel(d.machine)}</td>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(d.startTime)}</td>
                      <td style={TD}><Jump id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Truncated count={data.checks.outsideHours.count} shown={data.checks.outsideHours.items.length} />
            </Card>

            {/* 4. Integrita dat */}
            <Card icon="🧩" title="Integrita dat" subtitle="Osiřelý preset, neplatné hodnoty a rozešlé split-skupiny." copyKey="integrity" count={data.checks.integrity.count} error={data.checks.integrity.error}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8, border: "1px solid var(--border)", borderRadius: reportRadius.lg, overflow: "hidden" }}>
                {data.checks.integrity.breakdown.map((it) => (
                  <IntegrityRow key={it.key} issue={it} />
                ))}
              </div>
            </Card>

            {/* 5. Přílohy */}
            <Card icon="📎" title="Přílohy: soubory vs. databáze" subtitle="Metadata v DB bez souboru na disku (nebo naopak)." copyKey="attachments" count={data.checks.attachments.count} error={data.checks.attachments.error}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, fontSize: reportTypeScale.md }}>
                <div>Metadata v DB bez souboru na disku: <strong style={{ color: data.checks.attachments.missingFiles.length > 0 ? "var(--status-bad)" : "var(--text-muted)" }}>{data.checks.attachments.missingFiles.length}</strong></div>
                {data.checks.attachments.missingFiles.map((m) => (
                  <div key={m.id} style={{ fontSize: reportTypeScale.base, color: "var(--text-muted)" }}>· rezervace {m.reservationId} · {m.originalName} <code style={{ color: "var(--text-muted)" }}>({m.storageKey})</code></div>
                ))}
                <div style={{ marginTop: 4 }}>Soubor na disku bez metadat: <strong style={{ color: data.checks.attachments.orphanFiles.length > 0 ? "var(--status-bad)" : "var(--text-muted)" }}>{data.checks.attachments.orphanFiles.length}</strong></div>
                {data.checks.attachments.orphanFiles.map((o, i) => (
                  <div key={i} style={{ fontSize: reportTypeScale.base, color: "var(--text-muted)" }}>· rezervace {o.reservationId} · <code>{o.storageKey}</code></div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {loading && !data && <div style={{ color: "var(--text-muted)", fontSize: reportTypeScale.md }}>Spouštím kontroly…</div>}
    </div>
  );
}
