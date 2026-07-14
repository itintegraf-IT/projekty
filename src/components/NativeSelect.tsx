import React from "react";

/**
 * NativeSelect — jednotný stylovaný nativní `<select>` (audit #4/#32/#93).
 *
 * Nahrazuje dřív ~26× ručně kopírovaný vzor `div[position:relative] > select[appearance:none]
 * + chevron SVG + focus/blur/hover handlery`. Vzhled zůstává dnešní; kanonizuje rám
 * (radius 10, focus na `--ring`, chevron), rozměrové odchylky jdou přes prop.
 *
 * Nepatří do `ui/` — shadcn vrstvu plošně nerozšiřujeme (schválený směr „tokens + lehký
 * vlastní systém"). Hodnota se předává jako string (call-site si případně udělá Number()).
 */
export type NativeSelectProps = {
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
  /** Kanonická výška 32; odchylka jen kde to dává smysl (hustý řádek). */
  height?: number;
  /** Kanonický radius 10. */
  radius?: number;
  /** Per-site: 11 v hustých panelech, 12–13 v hlavních formulářích. */
  fontSize?: number;
  fontWeight?: number;
  /** Levý padding textu (pravý řeší chevron). */
  paddingLeft?: number;
  /** Ztlumit barvu textu, když je hodnota prázdná (placeholder efekt). */
  mutedWhenEmpty?: boolean;
  /** Přidat hover změnu pozadí (surface-2 → surface-3). */
  hover?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  id?: string;
  name?: string;
  /** Merge do stylu `<select>`. */
  selectStyle?: React.CSSProperties;
  /** Merge do obalového `<div>` (typicky flex/width v gridu). */
  wrapperStyle?: React.CSSProperties;
  chevronSize?: number;
};

export function NativeSelect({
  value,
  onChange,
  children,
  height = 32,
  radius = 10,
  fontSize = 12,
  fontWeight = 600,
  paddingLeft = 12,
  mutedWhenEmpty = false,
  hover = false,
  disabled = false,
  title,
  "aria-label": ariaLabel,
  id,
  name,
  selectStyle,
  wrapperStyle,
  chevronSize = 13,
}: NativeSelectProps) {
  const isEmpty = value === "" || value == null;
  const rightPad = chevronSize + 16;
  return (
    <div style={{ position: "relative", ...wrapperStyle }}>
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          width: "100%",
          height,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: radius,
          color: mutedWhenEmpty && isEmpty ? "var(--text-muted)" : "var(--text)",
          fontSize,
          fontWeight,
          fontFamily: "inherit",
          padding: `0 ${rightPad}px 0 ${paddingLeft}px`,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          outline: "none",
          ...selectStyle,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        onMouseEnter={hover ? (e) => (e.currentTarget.style.background = "var(--surface-3)") : undefined}
        onMouseLeave={hover ? (e) => (e.currentTarget.style.background = "var(--surface-2)") : undefined}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        color="var(--text-muted)"
        style={{
          position: "absolute",
          right: Math.round(rightPad / 2 - chevronSize / 2 + 2),
          top: "50%",
          transform: "translateY(-50%)",
          width: chevronSize,
          height: chevronSize,
          pointerEvents: "none",
        }}
      >
        <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
