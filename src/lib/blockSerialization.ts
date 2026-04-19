import { normalizeBlockVariant } from "@/lib/blockVariants";
import { civilDateToUTCMidnight, normalizeCivilDateInput, parseCivilDateWriteInput } from "@/lib/dateUtils";

const BLOCK_CIVIL_DATE_FIELDS = new Set([
  "deadlineExpedice",
  "dataRequiredDate",
  "materialRequiredDate",
  "pantoneRequiredDate",
]);

type SerializableBlock = {
  type: string;
  blockVariant?: string | null;
  startTime: Date;
  endTime: Date;
  deadlineExpedice: Date | null;
  dataRequiredDate: Date | null;
  materialRequiredDate: Date | null;
  pantoneRequiredDate: Date | null;
  printCompletedAt: Date | null;
  expeditionPublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  Reservation?: { confirmedAt: Date | null } | null;
  [key: string]: unknown;
};

export function serializeBlock<T extends SerializableBlock>(block: T) {
  const { Reservation, ...rest } = block;
  return {
    ...rest,
    blockVariant: normalizeBlockVariant(block.blockVariant as string | null | undefined, block.type),
    startTime: block.startTime.toISOString(),
    endTime: block.endTime.toISOString(),
    deadlineExpedice: normalizeCivilDateInput(block.deadlineExpedice),
    dataRequiredDate: normalizeCivilDateInput(block.dataRequiredDate),
    materialRequiredDate: normalizeCivilDateInput(block.materialRequiredDate),
    pantoneRequiredDate: normalizeCivilDateInput(block.pantoneRequiredDate),
    printCompletedAt: block.printCompletedAt?.toISOString() ?? null,
    expeditionPublishedAt: block.expeditionPublishedAt?.toISOString() ?? null,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
    reservationConfirmedAt: Reservation?.confirmedAt?.toISOString() ?? null,
  };
}

export function parseNullableCivilDateForDb(value: unknown): Date | null {
  const normalized =
    value instanceof Date
      ? normalizeCivilDateInput(value)
      : parseCivilDateWriteInput(value);
  return normalized ? civilDateToUTCMidnight(normalized) : null;
}

export function serializeAuditValue(field: string | null | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    if (field && BLOCK_CIVIL_DATE_FIELDS.has(field)) {
      return normalizeCivilDateInput(value) ?? "";
    }
    return value.toISOString();
  }
  if (typeof value === "string") {
    if (field && BLOCK_CIVIL_DATE_FIELDS.has(field)) {
      return normalizeCivilDateInput(value) ?? value;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && value.includes("T")) {
      return parsed.toISOString();
    }
    return value;
  }
  return String(value);
}
