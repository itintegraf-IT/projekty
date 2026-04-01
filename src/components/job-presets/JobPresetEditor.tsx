"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  summarizeJobPreset,
  type JobPreset,
  type JobPresetUpsertInput,
} from "@/lib/jobPresets";
import { BLOCK_VARIANTS, VARIANT_CONFIG, type BlockVariant } from "@/lib/blockVariants";

type CodebookOption = {
  id: number;
  category: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  shortCode: string | null;
  isWarning: boolean;
  badgeColor: string | null;
};

type JobPresetEditorSeed = Partial<JobPresetUpsertInput> & {
  id?: number;
  isSystemPreset?: boolean;
  sortOrder?: number;
};

type JobPresetEditorProps = {
  open: boolean;
  title: string;
  initialValue: JobPresetEditorSeed;
  onClose: () => void;
  onSaved: (preset: JobPreset) => void;
};

function StatusSelect({
  value,
  onChange,
  options,
  placeholder = "— nezadáno —",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  options: CodebookOption[];
  placeholder?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
        style={{
          appearance: "none",
          width: "100%",
          height: 34,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: value ? "var(--text)" : "var(--text-muted)",
          fontSize: 12,
          fontWeight: 600,
          padding: "0 30px 0 10px",
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.isWarning ? "⚠ " : ""}{option.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        color="var(--text-muted)"
        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, pointerEvents: "none" }}
      >
        <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function OffsetField({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
}) {
  const enabled = value !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{label}</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <Switch checked={enabled} onCheckedChange={(checked) => onChange(checked ? 0 : null)} />
          {enabled ? "Vyplnit" : "Nevyplňovat"}
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: enabled ? 1 : 0.5 }}>
        <input
          type="number"
          min={0}
          step={1}
          value={value ?? 0}
          disabled={!enabled}
          onChange={(event) => onChange(Number.isFinite(Number(event.target.value)) ? Number(event.target.value) : 0)}
          style={{
            width: 90,
            height: 32,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 600,
            padding: "0 10px",
            outline: "none",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {enabled ? (value === 0 ? "dnes" : `dnes + ${value} dní`) : "pole zůstane prázdné"}
        </span>
      </div>
    </div>
  );
}

export default function JobPresetEditor({
  open,
  title,
  initialValue,
  onClose,
  onSaved,
}: JobPresetEditorProps) {
  const [loadingCodebooks, setLoadingCodebooks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dataOptions, setDataOptions] = useState<CodebookOption[]>([]);
  const [materialOptions, setMaterialOptions] = useState<CodebookOption[]>([]);
  const [barvyOptions, setBarvyOptions] = useState<CodebookOption[]>([]);
  const [lakOptions, setLakOptions] = useState<CodebookOption[]>([]);

  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [appliesToZakazka, setAppliesToZakazka] = useState(true);
  const [appliesToRezervace, setAppliesToRezervace] = useState(true);
  const [blockVariant, setBlockVariant] = useState<BlockVariant | null>(null);
  const [specifikace, setSpecifikace] = useState("");
  const [dataStatusId, setDataStatusId] = useState<number | null>(null);
  const [dataRequiredDateOffsetDays, setDataRequiredDateOffsetDays] = useState<number | null>(null);
  const [materialStatusId, setMaterialStatusId] = useState<number | null>(null);
  const [materialRequiredDateOffsetDays, setMaterialRequiredDateOffsetDays] = useState<number | null>(null);
  const [materialInStock, setMaterialInStock] = useState<boolean | null>(null);
  const [pantoneRequiredDateOffsetDays, setPantoneRequiredDateOffsetDays] = useState<number | null>(null);
  const [barvyStatusId, setBarvyStatusId] = useState<number | null>(null);
  const [lakStatusId, setLakStatusId] = useState<number | null>(null);
  const [deadlineExpediceOffsetDays, setDeadlineExpediceOffsetDays] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;

    setName(initialValue.name ?? "");
    setIsActive(initialValue.isActive ?? true);
    setAppliesToZakazka(initialValue.appliesToZakazka ?? true);
    setAppliesToRezervace(initialValue.appliesToRezervace ?? true);
    setBlockVariant((initialValue.blockVariant as BlockVariant | null | undefined) ?? null);
    setSpecifikace(initialValue.specifikace ?? "");
    setDataStatusId(initialValue.dataStatusId ?? null);
    setDataRequiredDateOffsetDays(initialValue.dataRequiredDateOffsetDays ?? null);
    setMaterialStatusId(initialValue.materialStatusId ?? null);
    setMaterialRequiredDateOffsetDays(initialValue.materialRequiredDateOffsetDays ?? null);
    setMaterialInStock(initialValue.materialInStock ?? null);
    setPantoneRequiredDateOffsetDays(initialValue.pantoneRequiredDateOffsetDays ?? null);
    setBarvyStatusId(initialValue.barvyStatusId ?? null);
    setLakStatusId(initialValue.lakStatusId ?? null);
    setDeadlineExpediceOffsetDays(initialValue.deadlineExpediceOffsetDays ?? null);
    setError("");
  }, [initialValue, open]);

  useEffect(() => {
    if (!open) return;
    setLoadingCodebooks(true);
    Promise.all([
      fetch("/api/codebook?category=DATA").then((response) => response.json()),
      fetch("/api/codebook?category=MATERIAL").then((response) => response.json()),
      fetch("/api/codebook?category=BARVY").then((response) => response.json()),
      fetch("/api/codebook?category=LAK").then((response) => response.json()),
    ])
      .then(([data, material, barvy, lak]) => {
        setDataOptions(data);
        setMaterialOptions(material);
        setBarvyOptions(barvy);
        setLakOptions(lak);
      })
      .catch((fetchError) => {
        console.error("Job preset codebooks load failed", fetchError);
        setError("Nepodařilo se načíst číselníky pro preset.");
      })
      .finally(() => setLoadingCodebooks(false));
  }, [open]);

  const resolveLabel = useMemo(() => {
    const lookups = {
      DATA: new Map(dataOptions.map((option) => [option.id, option.label])),
      MATERIAL: new Map(materialOptions.map((option) => [option.id, option.label])),
      BARVY: new Map(barvyOptions.map((option) => [option.id, option.label])),
      LAK: new Map(lakOptions.map((option) => [option.id, option.label])),
    };
    return (category: "DATA" | "MATERIAL" | "BARVY" | "LAK", id: number) => lookups[category].get(id) ?? null;
  }, [barvyOptions, dataOptions, lakOptions, materialOptions]);

  const draftSummary = useMemo(() => summarizeJobPreset({
    id: initialValue.id ?? 0,
    name,
    isSystemPreset: initialValue.isSystemPreset ?? false,
    isActive,
    sortOrder: initialValue.sortOrder ?? 0,
    appliesToZakazka,
    appliesToRezervace,
    machineConstraint: null,
    blockVariant,
    specifikace: specifikace.trim() || null,
    dataStatusId,
    dataRequiredDateOffsetDays,
    materialStatusId,
    materialRequiredDateOffsetDays: materialInStock ? null : materialRequiredDateOffsetDays,
    materialInStock,
    pantoneRequiredDateOffsetDays,
    barvyStatusId,
    lakStatusId,
    deadlineExpediceOffsetDays,
    createdAt: "",
    updatedAt: "",
  }, resolveLabel), [
    appliesToRezervace,
    appliesToZakazka,
    barvyStatusId,
    blockVariant,
    dataRequiredDateOffsetDays,
    dataStatusId,
    deadlineExpediceOffsetDays,
    initialValue.id,
    initialValue.isSystemPreset,
    initialValue.sortOrder,
    isActive,
    lakStatusId,
    materialInStock,
    materialOptions,
    materialRequiredDateOffsetDays,
    materialStatusId,
    name,
    pantoneRequiredDateOffsetDays,
    resolveLabel,
    specifikace,
  ]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    setError("");

    const payload: JobPresetUpsertInput = {
      name: name.trim(),
      isActive,
      appliesToZakazka,
      appliesToRezervace,
      machineConstraint: null,
      blockVariant: appliesToZakazka ? blockVariant : null,
      specifikace: specifikace.trim() || null,
      dataStatusId,
      dataRequiredDateOffsetDays,
      materialStatusId,
      materialRequiredDateOffsetDays: materialInStock ? null : materialRequiredDateOffsetDays,
      materialInStock,
      pantoneRequiredDateOffsetDays,
      barvyStatusId,
      lakStatusId,
      deadlineExpediceOffsetDays,
    };

    try {
      const response = await fetch(initialValue.id ? `/api/job-presets/${initialValue.id}` : "/api/job-presets", {
        method: initialValue.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Nepodařilo se uložit preset.");
      }
      const preset = await response.json() as JobPreset;
      onSaved(preset);
    } catch (saveError) {
      console.error("Job preset save failed", saveError);
      setError(saveError instanceof Error ? saveError.message : "Nepodařilo se uložit preset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(860px, 100%)",
          maxHeight: "min(92vh, 980px)",
          overflow: "hidden",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
              {initialValue.isSystemPreset ? "Systémový preset" : "Vlastní preset"}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs text-slate-400">Zavřít</Button>
        </div>

        <div style={{ padding: 18, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {error && (
            <div style={{ borderRadius: 8, padding: "10px 12px", background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)", color: "var(--danger)", fontSize: 12 }}>
              {error}
            </div>
          )}

          <section style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Základ</div>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Název</div>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-9 text-sm"
                  disabled={Boolean(initialValue.isSystemPreset)}
                />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                Aktivní preset
              </label>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Použití</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                <Switch checked={appliesToZakazka} onCheckedChange={setAppliesToZakazka} />
                Použít pro zakázku
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                <Switch checked={appliesToRezervace} onCheckedChange={setAppliesToRezervace} />
                Použít pro rezervaci
              </label>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Stav zakázky</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setBlockVariant(null)}
                    style={{
                      height: 34,
                      borderRadius: 8,
                      border: blockVariant === null ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: blockVariant === null ? "color-mix(in oklab, var(--accent) 14%, transparent)" : "var(--surface-2)",
                      color: blockVariant === null ? "var(--accent)" : "var(--text-muted)",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Bez stavu
                  </button>
                  {BLOCK_VARIANTS.map((variant) => (
                    <button
                      key={variant}
                      type="button"
                      onClick={() => setBlockVariant(variant)}
                      style={{
                        minHeight: 34,
                        borderRadius: 8,
                        border: blockVariant === variant ? `1px solid ${VARIANT_CONFIG[variant].color}` : "1px solid var(--border)",
                        background: blockVariant === variant ? `${VARIANT_CONFIG[variant].color}22` : "var(--surface-2)",
                        color: blockVariant === variant ? VARIANT_CONFIG[variant].color : "var(--text-muted)",
                        fontSize: 9,
                        fontWeight: 700,
                        cursor: "pointer",
                        lineHeight: 1.2,
                      }}
                    >
                      {VARIANT_CONFIG[variant].label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>Platí jen pro zakázku.</div>
              </div>
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Výrobní sloupečky</div>
            {loadingCodebooks ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Načítám číselníky…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>DATA status</div>
                  <StatusSelect value={dataStatusId} onChange={setDataStatusId} options={dataOptions} />
                  <OffsetField value={dataRequiredDateOffsetDays} onChange={setDataRequiredDateOffsetDays} label="DATA datum" />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>MATERIÁL status</div>
                  <StatusSelect value={materialStatusId} onChange={setMaterialStatusId} options={materialOptions} />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                    <Switch checked={materialInStock === true} onCheckedChange={(checked) => setMaterialInStock(checked ? true : null)} />
                    Materiál skladem
                  </label>
                  <OffsetField value={materialRequiredDateOffsetDays} onChange={setMaterialRequiredDateOffsetDays} label="Materiál datum" />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <OffsetField value={pantoneRequiredDateOffsetDays} onChange={setPantoneRequiredDateOffsetDays} label="PANTONE datum" />
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>BARVY</div>
                    <StatusSelect value={barvyStatusId} onChange={setBarvyStatusId} options={barvyOptions} />
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>LAK</div>
                    <StatusSelect value={lakStatusId} onChange={setLakStatusId} options={lakOptions} />
                  </div>
                  <OffsetField value={deadlineExpediceOffsetDays} onChange={setDeadlineExpediceOffsetDays} label="Expedice" />
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Specifikace</div>
              <Textarea value={specifikace} onChange={(event) => setSpecifikace(event.target.value)} rows={3} className="text-sm resize-none" />
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)" }}>Náhled</div>
            <div style={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{name || "Nový preset"}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{draftSummary}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {appliesToZakazka ? "Zakázka" : ""}{appliesToZakazka && appliesToRezervace ? " + " : ""}{appliesToRezervace ? "Rezervace" : ""}
              </div>
            </div>
          </section>
        </div>

        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose} className="text-xs text-slate-400">Zrušit</Button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              minWidth: 132,
              height: 36,
              borderRadius: 10,
              border: "none",
              background: "var(--brand)",
              color: "var(--brand-contrast)",
              fontSize: 12,
              fontWeight: 800,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Ukládám…" : "Uložit preset"}
          </button>
        </div>
      </div>
    </div>
  );
}
