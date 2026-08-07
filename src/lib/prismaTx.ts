/**
 * Interaktivní transakční klient Prismy. Odvozeno z prvního parametru callbacku
 * `prisma.$transaction`, aby typ nemohl utéct od skutečné verze klienta.
 *
 * Do 8/2026 žila tahle deklarace jako doslovná kopie ve čtyřech souborech
 * (overlapCheck, overlapResolver.server, reflow.server, undoApply.server).
 * Sjednoceno kvůli `withRevision` (src/lib/revision.server.ts), který podstrkuje
 * klient se stejným typem — čtyři nezávislé kopie by se rozešly.
 */
export type PrismaTransactionClient = Parameters<
  Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]
>[0];
