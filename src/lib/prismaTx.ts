/**
 * Interaktivní transakční klient Prismy. Odvozeno z prvního parametru callbacku
 * `prisma.$transaction`, aby typ nemohl utéct od skutečné verze klienta.
 *
 * Do 8/2026 žila tahle deklarace jako doslovná kopie v pěti souborech
 * (overlapCheck, overlapResolver.server, reflow.server, undoApply.server).
 * Sjednoceno kvůli `withRevision` (src/lib/revision.server.ts), který podstrkuje
 * klient se stejným typem — pět nezávislých kopií by se rozešlo.
 */
export type PrismaTransactionClient = Parameters<
  Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]
>[0];
