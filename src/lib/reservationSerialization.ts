import { normalizeCivilDateInput } from "@/lib/dateUtils";

type ReservationLike = {
  requestedExpeditionDate: Date;
  requestedDataDate: Date;
  preparedAt: Date | null;
  scheduledStartTime: Date | null;
  scheduledEndTime: Date | null;
  scheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: Array<{ createdAt: Date } & Record<string, unknown>>;
  [key: string]: unknown;
};

export function serializeReservation<T extends ReservationLike>(reservation: T) {
  return {
    ...reservation,
    requestedExpeditionDate: normalizeCivilDateInput(reservation.requestedExpeditionDate),
    requestedDataDate: normalizeCivilDateInput(reservation.requestedDataDate),
    preparedAt: reservation.preparedAt?.toISOString() ?? null,
    scheduledStartTime: reservation.scheduledStartTime?.toISOString() ?? null,
    scheduledEndTime: reservation.scheduledEndTime?.toISOString() ?? null,
    scheduledAt: reservation.scheduledAt?.toISOString() ?? null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    attachments: reservation.attachments?.map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
}
