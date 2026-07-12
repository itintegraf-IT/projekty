export type ExpediceItemKind = "PLANNED_JOB" | "MANUAL_JOB" | "INTERNAL_TRANSFER";

export type ExpediceBlockItem = {
  sourceType: "block";
  itemKind: "PLANNED_JOB";
  id: number;
  orderNumber: string;
  description: string | null;
  expediceNote: string | null;
  doprava: string | null;
  deadlineExpedice: string;        // "YYYY-MM-DD"
  expeditionSortOrder: number | null;
  machine: string;
};

export type ExpediceManualItem = {
  sourceType: "manual";
  itemKind: "MANUAL_JOB" | "INTERNAL_TRANSFER";
  id: number;
  orderNumber: string | null;
  description: string | null;
  expediceNote: string | null;
  doprava: string | null;
  date: string | null;             // "YYYY-MM-DD" nebo null = fronta
  expeditionSortOrder: number | null;
};

export type ExpediceItem = ExpediceBlockItem | ExpediceManualItem;

export type ExpediceDay = {
  date: string;                    // "YYYY-MM-DD"
  items: ExpediceItem[];
};

export type ExpediceCandidate = {
  id: number;
  orderNumber: string;
  description: string | null;
  expediceNote: string | null;
  doprava: string | null;
  deadlineExpedice: string;        // "YYYY-MM-DD"
  machine: string;
};

export type ExpediceData = {
  days: ExpediceDay[];
  candidates: ExpediceCandidate[];
  queueItems: ExpediceManualItem[];
};

// ─── Sdílené formátování dat expedice (audit #59) ───────────────────────────
// Dřív 2 identické kopie v ExpediceDetailPanel a ExpediceAside.
const CS_MONTHS_SHORT = ["led","úno","bře","dub","kvě","čvn","čvc","srp","zář","říj","lis","pro"];

/** Civil dateKey ("YYYY-MM-DD") → "12. čvc 2026". */
export function formatDateCs(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return `${d.getUTCDate()}. ${CS_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
