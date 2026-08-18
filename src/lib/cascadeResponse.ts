import type { AppError } from "@/lib/errors";

/**
 * Jednotné tělo 409 odpovědi při překročení prahu kaskády.
 *
 * Vlastní modul má stejný důvod jako `errorStatus`: šest routes by jinak mělo
 * šest mírně odlišných kopií a klient by musel počítat s každou z nich.
 * `err.details` plní `assertCascadeConfirmed` (`cascadeLimit.server.ts`).
 */
export function cascadeConfirmBody(err: AppError): {
  error: string;
  code: "CASCADE_CONFIRM";
  cascade: { movedCount: number; maxShiftMs: number; farthestEnd: string | null };
} {
  const d = (err.details ?? {}) as Partial<{ movedCount: number; maxShiftMs: number; farthestEnd: string | null }>;
  return {
    error: err.message,
    code: "CASCADE_CONFIRM",
    cascade: {
      movedCount: typeof d.movedCount === "number" ? d.movedCount : 0,
      maxShiftMs: typeof d.maxShiftMs === "number" ? d.maxShiftMs : 0,
      farthestEnd: typeof d.farthestEnd === "string" ? d.farthestEnd : null,
    },
  };
}
