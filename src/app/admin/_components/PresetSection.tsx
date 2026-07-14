"use client";

import { useEffect, useState } from "react";
import { btnSecondary, btnDanger, btnAddAccent } from "@/lib/uiStyles";
import JobPresetEditor from "@/components/job-presets/JobPresetEditor";
import { summarizeJobPreset, type JobPreset } from "@/lib/jobPresets";
import { SECTION_BG, SEPARATOR, TEXT_PRIMARY, TEXT_SECONDARY, BORDER_SUBTLE } from "./adminShared";

// ─── Tab: Presety ────────────────────────────────────────────────────────────

export function PresetSection() {
  const [presets, setPresets] = useState<JobPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTitle, setEditorTitle] = useState("Nový preset");
  const [editorSeed, setEditorSeed] = useState<Partial<JobPreset> & { id?: number; isSystemPreset?: boolean; sortOrder?: number }>({
    isActive: true,
    appliesToZakazka: true,
    appliesToRezervace: true,
  });

  async function loadPresets() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/job-presets?includeInactive=true");
    if (!res.ok) {
      setError("Nepodařilo se načíst presety.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPresets(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    void loadPresets();
  }, []);

  async function handleMove(index: number, direction: -1 | 1) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= presets.length) return;
    const current = presets[index];
    const swapWith = presets[swapIndex];
    await Promise.all([
      fetch(`/api/job-presets/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: swapWith.sortOrder }),
      }),
      fetch(`/api/job-presets/${swapWith.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: current.sortOrder }),
      }),
    ]);
    await loadPresets();
  }

  async function handleToggleActive(preset: JobPreset) {
    const res = await fetch(`/api/job-presets/${preset.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !preset.isActive }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Nepodařilo se změnit stav presetu.");
      return;
    }
    await loadPresets();
  }

  async function handleDelete(preset: JobPreset) {
    if (!window.confirm(`Opravdu smazat preset '${preset.name}'?`)) return;
    const res = await fetch(`/api/job-presets/${preset.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Preset se nepodařilo smazat.");
      return;
    }
    await loadPresets();
  }

  function openCreate() {
    setEditorTitle("Nový preset");
    setEditorSeed({
      isActive: true,
      appliesToZakazka: true,
      appliesToRezervace: true,
    });
    setEditorOpen(true);
  }

  function openEdit(preset: JobPreset) {
    setEditorTitle(`Upravit preset: ${preset.name}`);
    setEditorSeed(preset);
    setEditorOpen(true);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Presety Job Builderu
        </span>
        <button
          onClick={openCreate}
          type="button"
          style={btnAddAccent}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <line x1="6" y1="2.25" x2="6" y2="9.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            <line x1="2.25" y1="6" x2="9.75" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Přidat preset
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, borderRadius: 8, padding: "10px 12px", background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)", color: "var(--danger)", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ background: SECTION_BG, borderRadius: 12, overflow: "hidden", border: `1px solid ${BORDER_SUBTLE}` }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Načítám...</div>
        ) : presets.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: TEXT_SECONDARY, fontSize: 13 }}>Žádné presety</div>
        ) : (
          presets.map((preset, index) => {
            const usage = [preset.appliesToZakazka ? "Zakázka" : null, preset.appliesToRezervace ? "Rezervace" : null].filter(Boolean).join(" + ");
            return (
              <div
                key={preset.id}
                style={{
                  borderBottom: index === presets.length - 1 ? "none" : `1px solid ${SEPARATOR}`,
                  background: preset.isActive ? "transparent" : "color-mix(in oklab, var(--surface-2) 60%, transparent)",
                }}
              >
                <div style={{ display: "flex", gap: 10, padding: "12px 12px 12px 8px", alignItems: "stretch" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, justifyContent: "center" }}>
                    <button onClick={() => handleMove(index, -1)} disabled={index === 0} style={{ ...btnSecondary, padding: "3px 7px", fontSize: 10, opacity: index === 0 ? 0.4 : 1 }}>↑</button>
                    <button onClick={() => handleMove(index, 1)} disabled={index === presets.length - 1} style={{ ...btnSecondary, padding: "3px 7px", fontSize: 10, opacity: index === presets.length - 1 ? 0.4 : 1 }}>↓</button>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>{preset.name}</div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "2px 8px",
                        background: preset.isSystemPreset ? "rgba(59,130,246,0.12)" : "rgba(16,185,129,0.12)",
                        color: preset.isSystemPreset ? "#60a5fa" : "#34d399",
                        border: `1px solid ${preset.isSystemPreset ? "rgba(59,130,246,0.25)" : "rgba(16,185,129,0.25)"}`,
                      }}>
                        {preset.isSystemPreset ? "Systémový" : "Vlastní"}
                      </span>
                      {!preset.isActive && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "2px 8px",
                          background: "rgba(148,163,184,0.12)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)",
                        }}>
                          Neaktivní
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginTop: 4, lineHeight: 1.45 }}>
                      {summarizeJobPreset(preset)}
                    </div>
                    <div style={{ fontSize: 10, color: TEXT_SECONDARY, marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span>{usage || "Bez použití"}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, alignItems: "stretch", minWidth: 108 }}>
                    <button style={btnSecondary} onClick={() => openEdit(preset)}>Upravit</button>
                    <button style={btnSecondary} onClick={() => handleToggleActive(preset)}>
                      {preset.isActive ? "Deaktivovat" : "Aktivovat"}
                    </button>
                    {!preset.isSystemPreset && (
                      <button style={btnDanger} onClick={() => handleDelete(preset)}>Smazat</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <JobPresetEditor
        open={editorOpen}
        title={editorTitle}
        initialValue={editorSeed}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          void loadPresets();
        }}
      />
    </div>
  );
}
