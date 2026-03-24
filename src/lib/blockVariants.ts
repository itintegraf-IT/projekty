export const BLOCK_VARIANTS = ["STANDARD", "BEZ_TECHNOLOGIE", "BEZ_SACKU", "POZASTAVENO"] as const;
export type BlockVariant = typeof BLOCK_VARIANTS[number];

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
