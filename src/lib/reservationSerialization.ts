import { normalizeCivilDateInput } from "@/lib/dateUtils";

type ReservationLike = {
  requestedExpeditionDate: Date | null;
  requestedDataDate: Date | null;
  preparedAt: Date | null;
  scheduledStartTime: Date | null;
  scheduledEndTime: Date | null;
  scheduledAt: Date | null;
  confirmedAt: Date | null;
  counterProposedExpeditionDate: Date | null;
  counterProposedDataDate: Date | null;
  counterProposedAt: Date | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attachments?: Array<{ createdAt: Date } & Record<string, unknown>>;
  [key: string]: unknown;
};

export function serializeReservation<T extends ReservationLike>(reservation: T) {
  return {
    ...reservation,
    requestedExpeditionDate: reservation.requestedExpeditionDate
      ? normalizeCivilDateInput(reservation.requestedExpeditionDate)
      : null,
    requestedDataDate: reservation.requestedDataDate
      ? normalizeCivilDateInput(reservation.requestedDataDate)
      : null,
    preparedAt: reservation.preparedAt?.toISOString() ?? null,
    scheduledStartTime: reservation.scheduledStartTime?.toISOString() ?? null,
    scheduledEndTime: reservation.scheduledEndTime?.toISOString() ?? null,
    scheduledAt: reservation.scheduledAt?.toISOString() ?? null,
    confirmedAt: reservation.confirmedAt?.toISOString() ?? null,
    counterProposedExpeditionDate: reservation.counterProposedExpeditionDate
      ? normalizeCivilDateInput(reservation.counterProposedExpeditionDate)
      : null,
    counterProposedDataDate: reservation.counterProposedDataDate
      ? normalizeCivilDateInput(reservation.counterProposedDataDate)
      : null,
    counterProposedAt: reservation.counterProposedAt?.toISOString() ?? null,
    withdrawnAt: reservation.withdrawnAt?.toISOString() ?? null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    attachments: reservation.attachments?.map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
}
