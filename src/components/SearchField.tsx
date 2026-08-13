"use client";

import { Input } from "@/components/ui/input";

/**
 * Textové pole pro hledání zakázky s křížkem a Esc.
 *
 * Vzniklo 13. 8. 2026: predikát shody se den předtím sjednotil do
 * `src/lib/orderSearch.ts`, ale VZHLED pole se zároveň rozmnožil na druhé místo —
 * DTP panel dostal vlastní hledání jako syrový `<input>` s inline styly, zatímco
 * hlavička planneru používala sdílený `<Input>`. Dvě pole, která dělají totéž,
 * se tím lišila výškou, fokusovým prstencem i chováním Esc.
 *
 * Komponenta drží jen společnou část: pole, křížek a Esc. Co je vlastní jednomu
 * místu (Enter = skok na další výsledek, počítadlo N/M se šipkami v planneru,
 * filtrační chipy v DTP panelu), zůstává u volajícího — sem by to přitáhlo
 * závislosti, které druhá strana nikdy nepoužije.
 */

export type SearchFieldSize = "sm" | "md";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Zavolá se křížkem i klávesou Esc — volající řeší, co všechno se má uklidit. */
  onClear: () => void;
  /** Enter v poli. Bez něj Enter nedělá nic (výchozí chování inputu). */
  onEnter?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  /** `md` = hlavička planneru (pevná šířka), `sm` = postranní panel (plná šířka). */
  size?: SearchFieldSize;
};

/**
 * `md` úmyslně opisuje třídy, které měla hlavička planneru před extrakcí
 * (`h-8 text-xs w-40`), aby se nejpoužívanější obrazovka vizuálně nehnula.
 * `sm` odpovídá dosavadnímu poli v DTP panelu — nižší, drobnější, přes celou šířku.
 *
 * POZOR na `md:` varianty: sdílený `<Input>` končí třídou `md:text-sm` a
 * `tailwind-merge` ji s bezvariantním `text-[11px]` NESPOJÍ (jiná varianta =
 * jiná skupina). Bez explicitního `md:` přepisu by se pole na každém viewportu
 * ≥ 768 px vykreslilo na 14 px — a v DTP panelu, který má minimální šířku 180 px,
 * by se uřízl i placeholder.
 */
const SIZE_CLASS: Record<SearchFieldSize, string> = {
  md: "h-8 text-xs md:text-xs w-40",
  sm: "h-7 text-[11px] md:text-[11px] w-full",
};

export function SearchField({
  value, onChange, onClear, onEnter,
  placeholder = "Hledat zakázku…",
  ariaLabel,
  size = "md",
}: Props) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", width: size === "sm" ? "100%" : undefined }}>
      <Input
        type="text"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); }
          if (e.key === "Escape") onClear();
        }}
        placeholder={placeholder}
        className={`${SIZE_CLASS[size]} theme-transition-fast`}
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--border)",
          color: "var(--text)",
          // Bez rezervy vpravo by křížek ležel na textu dlouhého dotazu.
          paddingRight: value ? 22 : undefined,
        }}
      />
      {value && (
        <button
          type="button"
          onClick={(e) => { if (e.button !== 0) return; onClear(); }}
          title="Zrušit hledání (Esc)"
          aria-label="Zrušit hledání"
          style={{
            // `right` se počítá od hrany POLE, ne od obalu volajícího — proto tu
            // komponenta má vlastní `position: relative` a proto stačí jedna
            // hodnota pro obě velikosti (DTP panel měl dřív `right: 16`, což byla
            // kompenzace za padding panelu, ne za šířku pole).
            position: "absolute", right: 6,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", padding: 0, lineHeight: 1,
            fontSize: size === "sm" ? 13 : 14,
            display: "flex", alignItems: "center",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
