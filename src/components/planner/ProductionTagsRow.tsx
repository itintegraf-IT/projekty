import type { ReactNode } from "react";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { toggleProductionVariant } from "@/lib/productionTags";

export type ProductionTagsRowProps = {
  obalka: boolean;
  onObalkaChange: (v: boolean) => void;
  vnitrky: boolean;
  onVnitrkyChange: (v: boolean) => void;
  tiskoveArchy: string[];
  onTiskoveArchyChange: (v: string[]) => void;
  tiskoveArchyOpts: string[];
  serie: string[];
  onSerieChange: (v: string[]) => void;
  serieOpts: string[];
  disabled?: boolean;
};

function TagLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{children}</div>;
}

export function ProductionTagsRow({
  obalka, onObalkaChange, vnitrky, onVnitrkyChange,
  tiskoveArchy, onTiskoveArchyChange, tiskoveArchyOpts,
  serie, onSerieChange, serieOpts, disabled = false,
}: ProductionTagsRowProps) {
  // OBÁLKA a VNITŘKY jsou vzájemně výlučné — zakázka je vždy buď jedno, nebo
  // druhé. Logika žije tady (ne v rodičích), aby ji sdíleli všichni tři
  // konzumenti: BlockEdit, Job Builder i plánování rezervace.
  const pick = (clicked: "obalka" | "vnitrky") => {
    const next = toggleProductionVariant({ obalka, vnitrky }, clicked);
    if (next.obalka !== obalka) onObalkaChange(next.obalka);
    if (next.vnitrky !== vnitrky) onVnitrkyChange(next.vnitrky);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.15fr 1.15fr", gap: 6, marginTop: 10, alignItems: "end", opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      {/* OBÁLKA */}
      <button type="button" onClick={() => pick("obalka")} style={{ height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", border: obalka ? "1px solid #facc15" : "1px solid var(--border)", background: obalka ? "color-mix(in oklab, #facc15 16%, transparent)" : "var(--surface-2)", color: obalka ? "#eab308" : "var(--text-muted)", transition: "all 100ms" }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: obalka ? "#facc15" : "transparent", border: obalka ? "1.5px solid #facc15" : "1.5px solid var(--border)" }}>
          {obalka && <svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#1a1206" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        OBÁLKA
      </button>
      {/* VNITŘKY */}
      <button type="button" onClick={() => pick("vnitrky")} style={{ height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", border: vnitrky ? "1px solid #22d3ee" : "1px solid var(--border)", background: vnitrky ? "color-mix(in oklab, #22d3ee 16%, transparent)" : "var(--surface-2)", color: vnitrky ? "#22d3ee" : "var(--text-muted)", transition: "all 100ms" }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: vnitrky ? "#22d3ee" : "transparent", border: vnitrky ? "1.5px solid #22d3ee" : "1.5px solid var(--border)" }}>
          {vnitrky && <svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#06222a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        VNITŘKY
      </button>
      {/* TISKOVÉ ARCHY */}
      <div>
        <TagLabel>Tiskové archy</TagLabel>
        <MultiSelectDropdown options={[...tiskoveArchyOpts, ...tiskoveArchy.filter((s) => !tiskoveArchyOpts.includes(s))]} selected={tiskoveArchy} onChange={onTiskoveArchyChange} disabled={disabled} />
      </div>
      {/* SÉRIE */}
      <div>
        <TagLabel>Série</TagLabel>
        <MultiSelectDropdown options={[...serieOpts, ...serie.filter((s) => !serieOpts.includes(s))]} selected={serie} onChange={onSerieChange} disabled={disabled} />
      </div>
    </div>
  );
}
