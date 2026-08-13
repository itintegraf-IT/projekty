"use client";

import React, { useState } from "react";
import { machineLabel } from "@/lib/machines";
import type { BlockRef, HealthData } from "./useHealthData";

interface HealthPanelProps {
  data: HealthData | null;
  loading: boolean;
  error: string | null;
  /** Celkový počet nálezů (z useHealthData). */
  total: number;
  /** Kolik z 5 kontrol má nález (z useHealthData). */
  badChecks: number;
  /** Znovu spustí kontroly — aktualizuje panel i odznak v záhlaví. */
  onRefresh: () => void;
}

const TYPE_CHIP: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#c0392b" };
const TYPE_LABEL: Record<string, string> = { ZAKAZKA: "ZAKÁZKA", REZERVACE: "REZERVACE", UDRZBA: "ÚDRŽBA" };

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
function jumpHref(blockId: number): string {
  return `/?highlight=${blockId}`;
}

function Chip({ type }: { type: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 5, color: "#fff", background: TYPE_CHIP[type] ?? "var(--surface-3)" }}>
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}
function Jump({ id }: { id: number }) {
  return <a href={jumpHref(id)} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>Otevřít v plánu →</a>;
}

function Card({ title, subtitle, icon, count, children, defaultOpen }: {
  title: string; subtitle: string; icon: string; count: number; children?: React.ReactNode; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bad = count > 0;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderLeft: `3px solid ${bad ? "var(--danger)" : "color-mix(in oklab, var(--success) 55%, var(--border))"}`,
      borderRadius: 11, overflow: "hidden",
    }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", cursor: "pointer", userSelect: "none" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, background: "var(--surface-2)" }}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, padding: "4px 11px", borderRadius: 999, fontVariantNumeric: "tabular-nums",
            color: bad ? "var(--danger)" : "var(--success)",
            background: bad ? "color-mix(in oklab, var(--danger) 20%, transparent)" : "color-mix(in oklab, var(--success) 18%, transparent)",
          }}>{bad ? count : "✓ 0"}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        </div>
      </div>
      {open && children && <div style={{ borderTop: "1px solid var(--border)", padding: "10px 15px 15px" }}>{children}</div>}
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, padding: "9px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" };
const TD: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: 13 };
function TableWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: 9 }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>{children}</table></div>;
}
function BlockCell({ r }: { r: BlockRef }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Chip type={r.type} />
      <span style={{ fontWeight: 600 }}>{r.orderNumber || `#${r.id}`}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(r.startTime)}–{fmtDateTime(r.endTime)}</span>
    </div>
  );
}

export default function HealthPanel({ data, loading, error, total, badChecks, onRefresh }: HealthPanelProps) {
  const sectionLabel: React.CSSProperties = { fontSize: 12, color: "var(--brand)", fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 12 };
  const refreshBtn = (
    <button onClick={onRefresh} disabled={loading} style={{ background: "var(--brand)", color: "var(--brand-contrast)", border: "1px solid var(--brand)", borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1, whiteSpace: "nowrap" }}>
      ↻ {loading ? "Kontroluji…" : "Překontrolovat teď"}
    </button>
  );

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionLabel}>Kontrolní panel</div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", color: "var(--danger)", fontSize: 13 }}>
          Chyba kontroly: {error} <button onClick={onRefresh} style={{ marginLeft: 8, background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontWeight: 600 }}>Zkusit znovu</button>
        </div>
      )}

      {!error && data && (
        <>
          {/* Souhrnný proužek */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: "var(--surface)", border: `1px solid ${total > 0 ? "color-mix(in oklab, var(--danger) 45%, var(--border))" : "color-mix(in oklab, var(--success) 40%, var(--border))"}`, borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 250 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, background: total > 0 ? "color-mix(in oklab, var(--danger) 22%, transparent)" : "color-mix(in oklab, var(--success) 20%, transparent)" }}>{total > 0 ? "⚠️" : "✓"}</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: total > 0 ? "var(--danger)" : "var(--success)" }}>
                  {total > 0 ? `${total} ${total === 1 ? "problém" : total < 5 ? "problémy" : "problémů"}` : "Vše v pořádku"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  {total > 0 ? `v ${badChecks} z 5 kontrol · ` : "5 kontrol bez nálezu · "}kontrola {fmtDateTime(data.checkedAt)}
                </div>
              </div>
            </div>
            {refreshBtn}
          </div>

          {/* Karty */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* 1. Překryvy */}
            <Card icon="🔀" title="Překryvy bloků" subtitle="Dva bloky na stejném stroji ve stejný čas — jen budoucí." count={data.checks.overlaps.count} defaultOpen={data.checks.overlaps.count > 0}>
              <TableWrap>
                <thead><tr><th style={TH}>Stroj</th><th style={TH}>Blok A</th><th style={TH}>Blok B</th><th style={TH}>Překryv</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.overlaps.items.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{machineLabel(p.machine)}</td>
                      <td style={TD}><BlockCell r={p.a} /></td>
                      <td style={TD}><BlockCell r={p.b} /></td>
                      <td style={{ ...TD, color: "var(--warning)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p.overlapMinutes} m</td>
                      <td style={TD}><Jump id={p.a.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

            {/* 2. Drift */}
            <Card icon="🕒" title="Drift konce bloku" subtitle="Uložený konec nesedí na aktuální pracovní kalendář." count={data.checks.drift.count} defaultOpen={data.checks.drift.count > 0}>
              <TableWrap>
                <thead><tr><th style={TH}>Zakázka</th><th style={TH}>Stroj</th><th style={TH}>Uložený konec</th><th style={TH}>Přepočítaný</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.drift.items.map((d) => (
                    <tr key={d.id}>
                      <td style={TD}><span style={{ fontWeight: 600 }}>{d.orderNumber || `#${d.id}`}</span><div style={{ fontSize: 11, color: "var(--text-muted)" }}>start {fmtDateTime(d.startTime)}</div></td>
                      <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{machineLabel(d.machine)}</td>
                      <td style={{ ...TD, color: "var(--text-muted)", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(d.storedEnd)}</td>
                      <td style={{ ...TD, color: "var(--warning)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{d.expectedEnd ? fmtDateTime(d.expectedEnd) : "nelze spočítat"}</td>
                      <td style={TD}><Jump id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

            {/* 3. Mimo provoz */}
            <Card icon="🚫" title="Bloky mimo provoz stroje" subtitle="Zakázka začíná, když stroj nejede a není to vědomý bypass." count={data.checks.outsideHours.count} defaultOpen={data.checks.outsideHours.count > 0}>
              <TableWrap>
                <thead><tr><th style={TH}>Zakázka</th><th style={TH}>Stroj</th><th style={TH}>Začátek</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.outsideHours.items.map((d) => (
                    <tr key={d.id}>
                      <td style={{ ...TD, fontWeight: 600 }}>{d.orderNumber || `#${d.id}`}</td>
                      <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{machineLabel(d.machine)}</td>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(d.startTime)}</td>
                      <td style={TD}><Jump id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

            {/* 4. Integrita dat */}
            <Card icon="🧩" title="Integrita dat" subtitle="Osiřelé vazby a neplatné hodnoty." count={data.checks.integrity.count} defaultOpen={data.checks.integrity.count > 0}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8, border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
                {data.checks.integrity.breakdown.map((it) => (
                  <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--surface)", padding: "9px 13px", fontSize: 13 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: it.count > 0 ? "var(--danger)" : "color-mix(in oklab, var(--success) 70%, transparent)" }} />
                    <span>{it.label}</span>
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                      {it.count > 0 && it.items[0] != null && <a href={jumpHref(it.items[0].id)} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>Otevřít první →</a>}
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: it.count > 0 ? "var(--danger)" : "var(--text-muted)" }}>{it.count}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* 5. Přílohy */}
            <Card icon="📎" title="Přílohy: soubory vs. databáze" subtitle="Metadata v DB bez souboru na disku (nebo naopak)." count={data.checks.attachments.count} defaultOpen={data.checks.attachments.count > 0}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, fontSize: 13 }}>
                <div>Metadata v DB bez souboru na disku: <strong style={{ color: data.checks.attachments.missingFiles.length > 0 ? "var(--danger)" : "var(--text-muted)" }}>{data.checks.attachments.missingFiles.length}</strong></div>
                {data.checks.attachments.missingFiles.map((m) => (
                  <div key={m.id} style={{ fontSize: 12, color: "var(--text-muted)" }}>· rezervace {m.reservationId} · {m.originalName} <code style={{ color: "var(--text-muted)" }}>({m.storageKey})</code></div>
                ))}
                <div style={{ marginTop: 4 }}>Soubor na disku bez metadat: <strong style={{ color: data.checks.attachments.orphanFiles.length > 0 ? "var(--danger)" : "var(--text-muted)" }}>{data.checks.attachments.orphanFiles.length}</strong></div>
                {data.checks.attachments.orphanFiles.map((o, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-muted)" }}>· rezervace {o.reservationId} · <code>{o.storageKey}</code></div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {loading && !data && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Spouštím kontroly…</div>}
    </div>
  );
}
