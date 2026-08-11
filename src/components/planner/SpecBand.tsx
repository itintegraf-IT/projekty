"use client";

import { SPEC_HIGHLIGHT } from "@/lib/blockStyles";

/**
 * Zvýrazněná specifikace na kartě bloku (připomínka plánovače, 8/2026).
 *
 * Do 8/2026 to byl poslední řádek karty v barvě popisu s průhledností 82 %,
 * navíc až od pevné výšky 80 px — u zakázek kratších než ~1,5 h ho plánovač
 * neviděl vůbec. Nově má tři podoby podle toho, kolik místa v kartě zbývá.
 * Prahy jsou od etapy „čitelnost timeline" (8/2026) odvozené z `typeScale`
 * (`src/lib/plannerTypography.ts`), ne napevno zapsané — čísla níž jsou
 * příklad pro výchozí stupeň M, na L/XL rostou spolu s písmem:
 *
 * | Výška bloku (M)                                | Podoba |
 * | ----------------------------------------------- | ------ |
 * | ≥ `thresholds.full + rowHeights.spec1` (M ~67px) | `SpecBand` — celý pás (2 řádky od `specTwoLine`, jinak 1 s elipsou) |
 * | < `thresholds.full + rowHeights.spec1`           | `SpecChip` — čtvereček „S" v řádku chipů, text v tooltipu |
 *
 * `SpecBand` se NIKDY nekreslí uříznutý — karta je flex column s `overflow:
 * hidden` a pás je poslední v pořadí, takže cokoliv, na co by nezbylo místo,
 * by se ořízlo odspodu (viz `BlockCard.tsx`, `specFitsBand`). Buď se ukáže
 * celý, nebo se nahradí značkou „S".
 *
 * Barvy jsou pevné literály z `blockStyles` (ne CSS tokeny) — vnitřek bloku je
 * barevný gradient stejný ve světlém i tmavém motivu, takže tokeny vázané na
 * motiv by tu kontrast rozbily.
 */

export function SpecBand({ text, twoLine, fontSize }: { text: string; twoLine: boolean; fontSize: number }) {
  return (
    <div style={{ padding: "0 6px 3px", flexShrink: 0, position: "relative", zIndex: 2 }}>
      <div
        title={text}
        style={{
          background: SPEC_HIGHLIGHT.bg,
          color: SPEC_HIGHLIGHT.text,
          borderRadius: 3,
          padding: "2px 6px",
          fontSize,
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
 * i při maximálním přiblížení jen `effectiveSlotHeight` px (na M 26 px, roste
 * s vyšším stupněm) — text tam nejde zobrazit, takže zbývá nepřehlédnutelná
 * značka a tooltip.
 */
export function SpecChip({ text, fontSize }: { text: string; fontSize: number }) {
  return (
    <span
      title={text}
      style={{
        flexShrink: 0,
        background: SPEC_HIGHLIGHT.bg,
        color: SPEC_HIGHLIGHT.text,
        borderRadius: 3,
        padding: "1px 4px",
        fontSize,
        fontWeight: 800,
        lineHeight: 1.2,
        letterSpacing: "0.04em",
      }}
    >
      S
    </span>
  );
}
