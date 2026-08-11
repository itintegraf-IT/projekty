import { BLOCK_VARIANTS, VARIANT_CONFIG, type BlockVariant } from "@/lib/blockVariants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import DatePickerField from "@/app/_components/DatePickerField";
import { NativeSelect } from "@/components/NativeSelect";
import { PrimaryCta } from "@/components/PrimaryCta";
import { machineBadgeStyle } from "@/components/planner/ShutdownManager";
import { ProductionTagsRow } from "@/components/planner/ProductionTagsRow";
import { copyTextToClipboard } from "@/lib/clipboardCopy";
import {
  type CodebookOption,
  TYPE_BUILDER_CONFIG,
  DURATION_OPTIONS,
  getJobPresetTone,
} from "@/lib/plannerTypes";
import type { UseJobBuilderReturn } from "@/hooks/useJobBuilder";

// ─── Pomocné funkce ───────────────────────────────────────────────────────────
function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h} hod`;
  return `${h}:${m.toString().padStart(2, "0")} hod`;
}

export function JobBuilderPanel({ jb, isDark }: { jb: UseJobBuilderReturn; isDark: boolean }) {
  const {
    orderNumber, setOrderNumber,
    type, setType,
    blockVariant, setBlockVariant,
    durationHours, setDurationHours,
    description, setDescription,
    bDeadlineExpedice, setBDeadlineExpedice,
    bDataStatusId, setBDataStatusId,
    bDataRequiredDate, setBDataRequiredDate,
    bMaterialStatusId, setBMaterialStatusId,
    bMaterialRequiredDate, setBMaterialRequiredDate,
    bMaterialInStock, setBMaterialInStock,
    bPantoneInStock, setBPantoneInStock,
    bPantoneRequiredDate, setBPantoneRequiredDate,
    bPantoneOk, setBPantoneOk,
    bPantoneRequired, setBPantoneRequired,
    bBarvyStatusId, setBBarvyStatusId,
    bLakStatusId, setBLakStatusId,
    bSpecifikace, setBSpecifikace,
    bObalka, setBObalka,
    bVnitrky, setBVnitrky,
    bTiskoveArchy, setBTiskoveArchy,
    bSerie, setBSerie,
    bTiskoveArchyOpts,
    bSerieOpts,
    bJobPresetId,
    bJobPresetLabel,
    bRecurrenceType, setBRecurrenceType,
    bRecurrenceCount, setBRecurrenceCount,
    bSeriesMachine, setBSeriesMachine,
    bSeriesFirstDate, setBSeriesFirstDate,
    bSeriesFirstHour, setBSeriesFirstHour,
    seriesPreview, setSeriesPreview,
    seriesScheduling,
    bDataOpts,
    bMaterialOpts,
    bBarvyOpts,
    bLakOpts,
    compatibleBuilderPresets,
    queue, setQueue,
    draggingQueueItem, setDraggingQueueItem,
    reservationQueue,
    applyPresetToBuilder,
    clearBuilderPresetSelection,
    handleAddToQueue,
    handleScheduleSeries,
  } = jb;

  const typeConfig = TYPE_BUILDER_CONFIG[type as keyof typeof TYPE_BUILDER_CONFIG];

  return (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--surface)", borderLeft: "1px solid var(--border)" }}>

              {/* ── Builder Header ── */}
              <div style={{ padding: "12px 16px", background: "linear-gradient(135deg, color-mix(in oklab, var(--surface-2) 95%, transparent) 0%, var(--surface) 100%)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 15, flexShrink: 0 }}>
                    J
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Job Builder</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>Integraf</div>
                  </div>
                </div>
              </div>

              {/* ── Formulář ── */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "0 16px", flex: 1 }}>

                  {/* ── Typ záznamu ── */}
                  <div style={{ paddingTop: 16, paddingBottom: 14, borderBottom: type === "ZAKAZKA" ? "none" : "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                      Typ záznamu
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(Object.entries(TYPE_BUILDER_CONFIG) as [string, typeof TYPE_BUILDER_CONFIG[keyof typeof TYPE_BUILDER_CONFIG]][]).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { setType(key); if (key !== "ZAKAZKA") setBlockVariant("STANDARD"); }}
                          style={{
                            flex: 1, padding: "8px 4px", borderRadius: 7,
                            border: type === key ? `1px solid ${cfg.color}` : "1px solid var(--border)",
                            background: type === key ? `${cfg.color}22` : "var(--surface-2)",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            transition: "all 0.15s",
                          }}
                        >
                          <cfg.icon size={16} strokeWidth={1.5} color={type === key ? cfg.color : "var(--text-muted)"} />
                          <span style={{ fontSize: 9, fontWeight: 600, color: type === key ? cfg.color : "var(--text-muted)", letterSpacing: "0.04em", lineHeight: 1.3, textAlign: "center" }}>
                            {cfg.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 10, paddingBottom: 14, borderBottom: type === "ZAKAZKA" ? "none" : "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                        Preset
                      </div>
                      {bJobPresetLabel && (
                        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Aktivní:
                            <span style={{ marginLeft: 6, color: "var(--text)", fontWeight: 700 }}>{bJobPresetLabel}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Předvyplnění je jen návrh
                          </div>
                        </div>
                      )}
                      {compatibleBuilderPresets.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5 }}>
                          {compatibleBuilderPresets.map((preset, index) => {
                            const active = bJobPresetId === preset.id;
                            const tone = getJobPresetTone(preset, index);
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => applyPresetToBuilder(preset)}
                                style={{
                                  minHeight: 30,
                                  padding: "5px 8px",
                                  borderRadius: 7,
                                  border: active ? `1px solid ${tone}` : "1px solid var(--border)",
                                  background: active ? `${tone}26` : "var(--surface-2)",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "all 0.12s",
                                  boxShadow: active ? `inset 0 1px 0 ${tone}33, 0 0 0 1px ${tone}22` : "none",
                                }}
                              >
                                <span style={{ fontSize: 8, fontWeight: active ? 700 : 600, color: active ? tone : "var(--text-muted)", letterSpacing: "0.03em", lineHeight: 1.15, textAlign: "center" }}>
                                  {preset.name}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          Pro tento typ zatím není dostupný žádný preset.
                        </div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          onClick={clearBuilderPresetSelection}
                          disabled={bJobPresetId === null && !bJobPresetLabel}
                          style={{
                            width: "100%", height: 34, borderRadius: 10, border: "1px solid color-mix(in oklab, var(--border) 88%, transparent)",
                            background: "linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 94%, white 6%) 0%, var(--surface-2) 100%)",
                            color: "var(--text-muted)", fontSize: 11, fontWeight: 700,
                            cursor: bJobPresetId === null && !bJobPresetLabel ? "default" : "pointer",
                            opacity: bJobPresetId === null && !bJobPresetLabel ? 0.5 : 1,
                            boxShadow: "inset 0 1px 0 color-mix(in oklab, white 24%, transparent)",
                          }}
                        >
                          Vyčistit preset
                        </button>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.4 }}>
                        Výběr pouze předvyplní nastavená pole. Vyčištění preset odpojí a smaže jeho předvyplněné hodnoty.
                      </div>
                    </div>
                  )}

                  {/* ── Stav zakázky — jen pro ZAKAZKA ── */}
                  {type === "ZAKAZKA" && (
                    <div style={{ paddingTop: 10, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
                        Stav zakázky
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        {(BLOCK_VARIANTS as readonly BlockVariant[]).map((v) => {
                          const cfg = VARIANT_CONFIG[v];
                          const isActive = blockVariant === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setBlockVariant(v)}
                              style={{
                                flex: 1, padding: "7px 4px", borderRadius: 7,
                                border: isActive ? `1px solid ${cfg.color}` : "1px solid var(--border)",
                                background: isActive ? `${cfg.color}22` : "var(--surface-2)",
                                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                                transition: "all 0.12s",
                              }}
                            >
                              <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? cfg.color : "var(--border)" }} />
                              <span style={{ fontSize: 8, fontWeight: 600, color: isActive ? cfg.color : "var(--text-muted)", lineHeight: 1.2, textAlign: "center" }}>
                                {cfg.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Zakázka ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      {type === "UDRZBA" ? "Popis" : "Zakázka"}
                    </div>

                    {/* Číslo zakázky + Délka tisku */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: "0 0 130px" }}>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>
                          {type === "UDRZBA" ? "Název / označení" : "Číslo zakázky"} *
                        </Label>
                        <Input
                          value={orderNumber}
                          onChange={(e) => setOrderNumber(e.target.value)}
                          placeholder={type === "UDRZBA" ? "Čištění hlavy…" : "17001"}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Délka tisku</label>
                        <NativeSelect value={String(durationHours)} onChange={(v) => setDurationHours(Number(v))} fontSize={13} paddingLeft={14} chevronSize={14} hover>
                          {DURATION_OPTIONS.map((opt) => (
                            <option key={opt.hours} value={String(opt.hours)}>{opt.label}</option>
                          ))}
                        </NativeSelect>
                      </div>
                    </div>

                    {/* Popis */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)" }}>Popis</Label>
                        <button
                          type="button"
                          onClick={() => void copyTextToClipboard(description)}
                          title="Kopírovat popis"
                          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "0 2px", lineHeight: 1, transition: "color 120ms ease-out" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          Kopírovat
                        </button>
                      </div>
                      <Textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                        placeholder="Firma – produkt – počet tisků…"
                        className="text-xs resize-none"
                      />
                    </div>
                  </div>

                  {/* ── Výrobní sloupečky (skryté pro Údržbu) ── */}
                  {type !== "UDRZBA" && (
                    <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Výrobní sloupečky</div>
                      {/* DATA — datum + dropdown v jednom řádku */}
                      <div>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Data</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          <div style={{ flex: "0 0 130px" }}>
                            <DatePickerField value={bDataRequiredDate} onChange={setBDataRequiredDate} placeholder="Datum dodání…" />
                          </div>
                          <NativeSelect value={bDataStatusId} onChange={setBDataStatusId} wrapperStyle={{ flex: 1 }} mutedWhenEmpty hover>
                            <option value="">— info —</option>
                            {bDataOpts.map((o) => (
                              <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                            ))}
                          </NativeSelect>
                        </div>
                      </div>

                      {/* Materiál — datum + dropdown v jednom řádku */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Materiál</label>
                          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: bMaterialInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer" }}>
                            <Switch checked={bMaterialInStock} onCheckedChange={(checked) => { setBMaterialInStock(checked); if (checked) setBMaterialRequiredDate(""); }} />
                            SKLADEM
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 6, opacity: bMaterialInStock ? 0.4 : 1, pointerEvents: bMaterialInStock ? "none" : "auto" }}>
                          <div style={{ flex: "0 0 130px" }}>
                            <DatePickerField value={bMaterialRequiredDate} onChange={setBMaterialRequiredDate} placeholder="Datum dodání…" />
                          </div>
                          <NativeSelect value={bMaterialStatusId} onChange={setBMaterialStatusId} wrapperStyle={{ flex: 1 }} mutedWhenEmpty hover>
                            <option value="">— info —</option>
                            {bMaterialOpts.map((o) => (
                              <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                            ))}
                          </NativeSelect>
                        </div>
                      </div>

                      {/* Pantone + Barvy + Lak — 3-sloupcový grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {/* Pantone — datepicker + potřeba/OK vedle sebe */}
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Pantone</label>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: bPantoneInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer" }}>
                              <Switch checked={bPantoneInStock} onCheckedChange={(checked) => { setBPantoneInStock(checked); if (checked) { setBPantoneRequiredDate(""); setBPantoneOk(false); setBPantoneRequired(true); } }} />
                              SKLADEM
                            </label>
                          </div>
                          <div style={{ opacity: bPantoneInStock ? 0.4 : 1, pointerEvents: bPantoneInStock ? "none" : "auto" }}>
                            <DatePickerField value={bPantoneRequiredDate} onChange={(v) => { setBPantoneRequiredDate(v); if (v) setBPantoneRequired(true); }} placeholder="Datum…" />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
                            <button type="button" onClick={() => {
                              const next = !bPantoneRequired;
                              setBPantoneRequired(next);
                              if (!next) { setBPantoneRequiredDate(""); setBPantoneOk(false); setBPantoneInStock(false); }
                            }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: bPantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: bPantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: bPantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                              {bPantoneRequired ? "⚠ POTŘEBA" : "POTŘEBA"}
                            </button>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: bPantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                              <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: bPantoneOk ? "var(--success)" : "transparent", border: bPantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                                {bPantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                              </div>
                              <input type="checkbox" checked={bPantoneOk} onChange={(e) => setBPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                              OK
                            </label>
                          </div>
                        </div>
                        {/* Barvy + Lak */}
                        {([
                          { label: "Barvy",   value: bBarvyStatusId,    setter: setBBarvyStatusId,    opts: bBarvyOpts },
                          { label: "Lak",     value: bLakStatusId,      setter: setBLakStatusId,      opts: bLakOpts },
                        ] as { label: string; value: string; setter: (v: string) => void; opts: CodebookOption[] }[]).map(({ label, value, setter, opts }) => (
                          <div key={label}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>{label}</label>
                            <NativeSelect value={value} onChange={setter} mutedWhenEmpty hover>
                              <option value="">— nezadáno —</option>
                              {opts.map((o) => (
                                <option key={o.id} value={String(o.id)}>{o.isWarning ? "⚠ " : ""}{o.label}</option>
                              ))}
                            </NativeSelect>
                          </div>
                        ))}
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Specifikace</Label>
                        <Input value={bSpecifikace} onChange={(e) => setBSpecifikace(e.target.value)} placeholder="Volný text…" className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block" }}>Termín expedice</Label>
                        <DatePickerField value={bDeadlineExpedice} onChange={setBDeadlineExpedice} placeholder="Datum expedice…" />
                      </div>
                    </div>
                  )}

                  {/* ── Opakování ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>Opakování</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Interval</label>
                        <NativeSelect value={bRecurrenceType} onChange={setBRecurrenceType}>
                          <option value="NONE">— bez opakování —</option>
                          <option value="DAILY">↻ Každý den</option>
                          <option value="WEEKLY">↻ Každý týden</option>
                          <option value="MONTHLY">↻ Každý měsíc</option>
                        </NativeSelect>
                      </div>
                      {bRecurrenceType !== "NONE" && (
                        <div style={{ flex: "0 0 90px" }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Počet bloků</label>
                          <input
                            type="number"
                            min={2}
                            max={52}
                            value={bRecurrenceCount}
                            onChange={(e) => setBRecurrenceCount(Math.max(2, Math.min(52, parseInt(e.target.value) || 2)))}
                            style={{
                              width: "100%", height: 32, background: "var(--surface-2)",
                              border: "1px solid var(--border)", borderRadius: 10,
                              color: "var(--text)", fontSize: 13, fontWeight: 700,
                              padding: "0 10px", outline: "none", textAlign: "center",
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {bRecurrenceType !== "NONE" && (
                      <>
                        {/* Stroj */}
                        <div style={{ marginTop: 10 }}>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Stroj</label>
                          <div style={{ display: "flex", gap: 4 }}>
                            {(["XL_105", "XL_106"] as const).map((m) => (
                              <button key={m} type="button" onClick={() => setBSeriesMachine(m)} style={{
                                flex: 1, height: 28, borderRadius: 6, fontSize: 11, fontWeight: bSeriesMachine === m ? 700 : 500,
                                border: bSeriesMachine === m ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--border)",
                                background: bSeriesMachine === m ? "rgba(59,130,246,0.15)" : "var(--surface-2)",
                                color: bSeriesMachine === m ? "#93c5fd" : "var(--text-muted)",
                                cursor: "pointer", transition: "all 0.12s ease-out",
                              }}>{m === "XL_105" ? "XL 105" : "XL 106"}</button>
                            ))}
                          </div>
                        </div>
                        {/* První výskyt */}
                        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-end" }}>
                          <div style={{ flex: 1 }}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Datum 1. výskytu</label>
                            <DatePickerField value={bSeriesFirstDate} onChange={setBSeriesFirstDate} placeholder="Datum…" />
                          </div>
                          <div style={{ flex: "0 0 84px" }}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Čas</label>
                            <NativeSelect value={bSeriesFirstHour} onChange={(v) => setBSeriesFirstHour(parseInt(v))} paddingLeft={10} chevronSize={11}>
                              {Array.from({ length: 24 }, (_, h) => (
                                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                              ))}
                            </NativeSelect>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* ── Výrobní štítky (zakázka i rezervace, jednorázový záznam) ── */}
                  {type !== "UDRZBA" && bRecurrenceType === "NONE" && (
                    <div style={{ paddingTop: 12, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Výrobní štítky</div>
                      <ProductionTagsRow
                        obalka={bObalka} onObalkaChange={setBObalka}
                        vnitrky={bVnitrky} onVnitrkyChange={setBVnitrky}
                        tiskoveArchy={bTiskoveArchy} onTiskoveArchyChange={setBTiskoveArchy} tiskoveArchyOpts={bTiskoveArchyOpts}
                        serie={bSerie} onSerieChange={setBSerie} serieOpts={bSerieOpts}
                      />
                    </div>
                  )}
                  {type !== "UDRZBA" && bRecurrenceType !== "NONE" && (
                    <div style={{ paddingTop: 12, paddingBottom: 14, borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                      Štítky (OBÁLKA/VNITŘKY, archy, série) nastavíš u série po založení — editací bloku.
                    </div>
                  )}

                  {/* ── Preview série ── */}
                  {bRecurrenceType !== "NONE" && seriesPreview.length > 0 && (
                    <div style={{ paddingTop: 12, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Preview série</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                        {seriesPreview.map((occ, i) => (
                          <div
                            key={i}
                            title={
                              occ.wasShifted
                                ? `Posunuto kvůli kapacitě stroje — původně ${occ.originalDate} ${String(occ.originalHour).padStart(2, "0")}:00`
                                : undefined
                            }
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              padding: "6px 8px",
                              borderRadius: 7,
                              background: occ.wasShifted
                                ? (isDark ? "rgba(255, 230, 0, 0.12)" : "#fef3c7")
                                : "rgba(255,255,255,0.03)",
                              border: occ.wasShifted
                                ? (isDark ? "1px solid rgba(255, 230, 0, 0.45)" : "1px solid #f59e0b")
                                : "1px solid rgba(255,255,255,0.06)",
                              borderLeft: occ.wasShifted
                                ? (isDark ? "3px solid #FFE600" : "3px solid #d97706")
                                : "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            {occ.wasShifted && (
                              <div style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: isDark ? "#FFE600" : "#92400e",
                                letterSpacing: "0.04em",
                                marginBottom: 2,
                              }}>
                                ⚠ Posunuto z {occ.originalDate} {String(occ.originalHour).padStart(2, "0")}:00 (kapacita)
                              </div>
                            )}
                            {/* Řádek 1: badge + Tisk datum + hodina */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{
                                flexShrink: 0, width: 20, height: 20, borderRadius: 4,
                                background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 9, fontWeight: 700, color: "#93c5fd",
                              }}>{i + 1}</div>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>Tisk:</div>
                              <div style={{ flex: 1 }}>
                                <DatePickerField
                                  value={occ.date}
                                  onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, date: d, wasShifted: false } : o))}
                                  placeholder="Datum…"
                                />
                              </div>
                              <NativeSelect
                                wrapperStyle={{ flex: "0 0 72px" }}
                                value={occ.hour}
                                onChange={(v) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, hour: parseInt(v), wasShifted: false } : o))}
                                height={30}
                                fontSize={11}
                                paddingLeft={8}
                                chevronSize={10}
                              >
                                {Array.from({ length: 24 }, (_, h) => (
                                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                                ))}
                              </NativeSelect>
                            </div>
                            {/* Řádek 2: DATA datum + EXP datum */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 26 }}>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 28, flexShrink: 0 }}>DATA:</div>
                              <div style={{ flex: 1 }}>
                                <DatePickerField
                                  value={occ.dataRequiredDate}
                                  onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, dataRequiredDate: d } : o))}
                                  placeholder="Termín dat…"
                                />
                              </div>
                              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", width: 24, flexShrink: 0, textAlign: "right" }}>EXP:</div>
                              <div style={{ flex: 1 }}>
                                <DatePickerField
                                  value={occ.deadlineExpedice}
                                  onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) => j === i ? { ...o, deadlineExpedice: d } : o))}
                                  placeholder="Expedice…"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Live náhled ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Náhled bloku</div>
                    <div style={{
                      borderRadius: 6, padding: "9px 11px",
                      background: `${typeConfig?.color ?? "#334155"}18`,
                      borderTop: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderRight: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderBottom: `1px solid ${typeConfig?.color ?? "var(--text-muted)"}33`,
                      borderLeft: `3px solid ${typeConfig?.color ?? "var(--text-muted)"}`,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
                        {orderNumber || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                      </div>
                      {description && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{description}</div>
                      )}
                      {bJobPresetLabel && type !== "UDRZBA" && (
                        <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 4, lineHeight: 1.4, fontWeight: 700 }}>
                          {bJobPresetLabel}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: typeConfig?.color ?? "var(--text-muted)", marginTop: 5 }}>
                        {typeConfig && <typeConfig.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{typeConfig?.label} · {formatDuration(durationHours)}
                      </div>
                    </div>
                  </div>

                  {/* ── CTA — podmíněné ── */}
                  <div style={{ paddingTop: 14, paddingBottom: 16 }}>
                    {bRecurrenceType !== "NONE" ? (
                      <>
                        <PrimaryCta
                          press
                          onClick={handleScheduleSeries}
                          disabled={!orderNumber.trim() || seriesPreview.length === 0 || seriesScheduling}
                        >
                          {seriesScheduling ? "Plánuji…" : `↻ Naplánovat sérii (${seriesPreview.length} bloků)`}
                        </PrimaryCta>
                        {seriesPreview.length === 0 && (
                          <div style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
                            Zadej datum prvního výskytu pro zobrazení preview
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <PrimaryCta press onClick={handleAddToQueue} disabled={!orderNumber.trim()}>
                          + Přidat do fronty
                        </PrimaryCta>
                        <div style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
                          Přetáhni kartu z fronty na timeline → stroj a čas
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Fronta ── */}
                {queue.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)" }}>Fronta</div>
                      <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: "var(--brand)", color: "var(--brand-contrast)", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                        {queue.length}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {queue.map((item) => {
                        const itemCfg = TYPE_BUILDER_CONFIG[item.type as keyof typeof TYPE_BUILDER_CONFIG];
                        return (
                          <div
                            key={item.id}
                            className="pressable-card"
                            onMouseDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              setDraggingQueueItem(item);
                            }}
                            style={{
                              display: "flex", alignItems: "stretch",
                              background: "var(--surface)",
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              overflow: "hidden",
                              cursor: draggingQueueItem?.id === item.id ? "grabbing" : "grab",
                            }}
                          >
                            {/* Barevný pruh vlevo */}
                            <div style={{ width: 3, background: itemCfg?.color ?? "var(--text-muted)", flexShrink: 0 }} />
                            {/* Obsah */}
                            <div style={{ flex: 1, padding: "7px 9px", minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{item.orderNumber}</div>
                                {item.machine && (
                                  <span style={{ ...machineBadgeStyle(item.machine), marginLeft: "auto" }}>
                                    {item.machine === "XL_105" ? "XL 105" : "XL 106"}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                {itemCfg && <itemCfg.icon size={10} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 3 }} />}{itemCfg?.label} · {formatDuration(item.durationHours)}
                              </div>
                              {item.description && (
                                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.description}
                                </div>
                              )}
                            </div>
                            {/* Smazat */}
                            <button
                              type="button"
                              onClick={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
                              onMouseDown={(e) => e.stopPropagation()}
                              style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, padding: "0 10px", display: "flex", alignItems: "center", lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Připravené rezervace ── */}
                {reservationQueue.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "rgba(124,58,237,0.04)", padding: "12px 16px 16px", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#7c3aed" }}>Připravené rezervace</div>
                      <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: "#7c3aed", color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                        {reservationQueue.length}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {reservationQueue.map((item) => (
                        <div
                          key={item.id}
                          className="pressable-card"
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            setDraggingQueueItem(item);
                          }}
                          style={{
                            display: "flex", alignItems: "stretch",
                            background: "var(--surface)",
                            borderRadius: 6,
                            border: "1px solid rgba(124,58,237,0.3)",
                            overflow: "hidden",
                            cursor: draggingQueueItem?.id === item.id ? "grabbing" : "grab",
                          }}
                        >
                          <div style={{ width: 3, background: "#7c3aed", flexShrink: 0 }} />
                          <div style={{ flex: 1, padding: "7px 9px", minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", background: "rgba(124,58,237,0.12)", padding: "1px 5px", borderRadius: 4 }}>
                                {item.reservationCode}
                              </span>
                              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Rezervace</span>
                              {item.reservationMachine && (
                                <span style={{ fontSize: 9, fontWeight: 600, color: item.reservationMachine === "XL_105" ? "#3b82f6" : "#16a34a", background: item.reservationMachine === "XL_105" ? "rgba(59,130,246,0.12)" : "rgba(22,163,74,0.12)", padding: "1px 5px", borderRadius: 4, marginLeft: "auto" }}>
                                  {item.reservationMachine === "XL_105" ? "XL 105" : "XL 106"}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.companyName}
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                              <span>{formatDuration(item.durationHours)}</span>
                              {item.dataRequiredDate && (
                                <span>Data: <strong style={{ color: "var(--text)" }}>{new Date(item.dataRequiredDate + "T00:00:00").toLocaleDateString("cs-CZ", { day: "numeric", month: "short", timeZone: "UTC" })}</strong></span>
                              )}
                              {item.materialInStock ? (
                                <span>Mat: <strong style={{ color: "#10b981" }}>skladem</strong></span>
                              ) : item.materialRequiredDate ? (
                                <span>Mat: <strong style={{ color: "var(--text)" }}>{new Date(item.materialRequiredDate + "T00:00:00").toLocaleDateString("cs-CZ", { day: "numeric", month: "short", timeZone: "UTC" })}</strong></span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
  );
}
