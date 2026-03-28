export const BLOCK_VARIANTS = ["STANDARD", "BEZ_TECHNOLOGIE", "BEZ_SACKU", "POZASTAVENO"] as const;
export type BlockVariant = typeof BLOCK_VARIANTS[number];

export const VARIANT_CONFIG: Record<BlockVariant, { label: string; color: string }> = {
  STANDARD:         { label: "Klasická",         color: "#3b82f6" },
  BEZ_TECHNOLOGIE:  { label: "Bez technologie",  color: "#059669" },
  BEZ_SACKU:        { label: "Bez sáčku",        color: "#e36414" },
  POZASTAVENO:      { label: "Pozastaveno",       color: "#d00000" },
};

export function normalizeBlockVariant(
  variant: string | null | undefined,
  type: string
): BlockVariant {
  if (type !== "ZAKAZKA") return "STANDARD";
  if (variant && (BLOCK_VARIANTS as readonly string[]).includes(variant)) {
    return variant as BlockVariant;
  }
  return "STANDARD";
}
