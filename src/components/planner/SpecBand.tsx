"use client";

import { SPEC_HIGHLIGHT } from "@/lib/blockStyles";

/**
 * Zvýrazněná specifikace na kartě bloku (připomínka plánovače, 8/2026).
 *
 * Do 8/2026 to byl poslední řádek karty v barvě popisu s průhledností 82 %,
 * navíc až od výšky 80 px — u zakázek kratších než ~1,5 h ho plánovač neviděl
 * vůbec. Nově má tři podoby podle toho, kolik místa v kartě zbývá:
 *
 * | Výška bloku | Podoba |
 * | ----------- | ------ |
 * | ≥ 80 px     | `SpecBand` přes dva řádky |
 * | 48–79 px    | `SpecBand` na jeden řádek s elipsou |
 * | < 48 px     | `SpecChip` — čtvereček „S" v řádku chipů, text v tooltipu |
 *
 * Barvy jsou pevné literály z `blockStyles` (ne CSS tokeny) — vnitřek bloku je
 * barevný gradient stejný ve světlém i tmavém motivu, takže tokeny vázané na
 * motiv by tu kontrast rozbily.
 */

export function SpecBand({ text, twoLine }: { text: string; twoLine: boolean }) {
  return (
    <div style={{ padding: "0 6px 3px", flexShrink: 0, position: "relative", zIndex: 2 }}>
      <div
        title={text}
        style={{
          background: SPEC_HIGHLIGHT.bg,
          color: SPEC_HIGHLIGHT.text,
          borderRadius: 3,
          padding: "2px 6px",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1.3,
          letterSpacing: "0.01em",
          ...(twoLine
            ? { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }
            : { whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }),
        }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Zkratka specifikace pro karty, kam se pás nevejde. Půlhodinová zakázka má
 * i při maximálním přiblížení jen 26 px — text tam neexistuje způsob, jak
 * zobrazit, takže zbývá nepřehlédnutelná značka a tooltip.
 */
export function SpecChip({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        flexShrink: 0,
        background: SPEC_HIGHLIGHT.bg,
        color: SPEC_HIGHLIGHT.text,
        borderRadius: 3,
        padding: "1px 4px",
        fontSize: 9,
        fontWeight: 800,
        lineHeight: 1.2,
        letterSpacing: "0.04em",
      }}
    >
      S
    </span>
  );
}
