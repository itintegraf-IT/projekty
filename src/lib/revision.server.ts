import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { logger } from "@/lib/logger";
import { normalizeBlockRow } from "@/lib/revision/rowNormalize";
import { computeRevisionDiff } from "@/lib/revision/diff";

export type RevisionAction =
  | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
  | "SPLIT" | "REFLOW" | "UNDO" | "PRINT_COMPLETE" | "EXPEDITION";

type Row = Record<string, unknown>;
type Kind = "CREATE" | "UPDATE" | "DELETE";

/**
 * Neúplné zachycení: mezi snapshotem a zápisem se objevil fantom.
 * Ve vývoji a testech se hází, na produkci se degraduje na `partial: true` —
 * spadnout uživateli uprostřed plánování je horší než neúplná revize.
 */
function onCountMismatch(groupId: string, captured: number, affected: number, cap: Capture, op: string): void {
  cap.partial = true;
  const msg = `[revize] ${op} zasáhl ${affected} řádků, ale zachytilo se ${captured} (groupId ${groupId})`;
  if (process.env.NODE_ENV !== "production") throw new Error(msg);
  logger.error(msg);
}

/** Sběrač stavu jedné transakce. */
class Capture {
  readonly before = new Map<number, Row>();
  readonly kinds = new Map<number, Kind>();
  partial = false;

  markKind(id: number, kind: Kind) {
    // CREATE i DELETE přebíjí UPDATE: řádek, který v téže transakci vznikl
    // a pak se změnil, je pořád CREATE.
    const current = this.kinds.get(id);
    if (current === "CREATE" && kind === "UPDATE") return;
    this.kinds.set(id, kind);
  }
}

/** Zamykající current-read dotčených řádků. Neopakuje už zachycené. */
async function captureBefore(tx: PrismaTransactionClient, cap: Capture, ids: number[]) {
  const missing = ids.filter((id) => !cap.before.has(id));
  if (missing.length === 0) return;
  const rows = await tx.$queryRaw<Row[]>`
    SELECT * FROM Block WHERE id IN (${Prisma.join(missing)}) FOR UPDATE
  `;
  for (const raw of rows) {
    const row = normalizeBlockRow(raw);
    cap.before.set(Number(row.id), row);
  }
}

/** Id, kterých se `where` týká. Pro update/delete stačí `id`, jinak dohledat. */
async function resolveIds(
  tx: PrismaTransactionClient,
  where: unknown,
  many: boolean,
): Promise<number[]> {
  const w = where as { id?: unknown } | undefined;
  if (!many && typeof w?.id === "number") return [w.id];
  const rows = await tx.block.findMany({
    where: where as Prisma.BlockWhereInput,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function makeClient(tx: PrismaTransactionClient, cap: Capture, groupId: string): PrismaTransactionClient {
  const blockDelegate = new Proxy(tx.block, {
    get(target, prop, receiver) {
      switch (prop) {
        case "update":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, false);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "UPDATE"));
            return (target as any).update(args);
          };
        case "updateMany":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "UPDATE"));
            const res = await (target as any).updateMany(args);
            if (res.count !== ids.length) onCountMismatch(groupId, ids.length, res.count, cap, "updateMany");
            return res;
          };
        case "delete":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, false);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "DELETE"));
            return (target as any).delete(args);
          };
        case "deleteMany":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "DELETE"));
            const res = await (target as any).deleteMany(args);
            if (res.count !== ids.length) onCountMismatch(groupId, ids.length, res.count, cap, "deleteMany");
            return res;
          };
        case "create":
          return async (args: unknown) => {
            const created = await (target as any).create(args);
            cap.markKind(created.id, "CREATE");
            return created;
          };
        case "createMany":
          // MySQL nevrací id z createMany, takže revizi k nim nejde přiřadit.
          return () => {
            throw new Error(
              "block.createMany není uvnitř withRevision podporované — MySQL nevrací id, " +
              "takže revizi nelze zapsat. Použij create ve smyčce.",
            );
          };
        default:
          return Reflect.get(target, prop, receiver);
      }
    },
  });

  const auditDelegate = new Proxy(tx.auditLog, {
    get(target, prop, receiver) {
      if (prop === "create") {
        return (args: { data: Record<string, unknown> }) =>
          (target as any).create({ ...args, data: { ...args.data, groupId } });
      }
      if (prop === "createMany") {
        return (args: { data: Record<string, unknown>[] }) =>
          (target as any).createMany({
            ...args,
            data: args.data.map((row) => ({ ...row, groupId })),
          });
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "block") return blockDelegate;
      if (prop === "auditLog") return auditDelegate;
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaTransactionClient;
}

/**
 * Obalí celou mutaci: otevře transakci, podstrčí tělu klient s nahrazenými
 * delegáty `block` a `auditLog`, a na konci zapíše revize.
 *
 * Tělo NIKDY nedostane syrový `tx` — proto se do revize nedá „zapomenout"
 * zapsat: jinudy zapsat nejde.
 */
export async function withRevision<T>(
  meta: {
    action: RevisionAction;
    label: string;
    user: { id: number; username: string };
    txOptions?: { timeout?: number; maxWait?: number };
  },
  body: (rtx: PrismaTransactionClient) => Promise<T>,
): Promise<{ result: T; groupId: string }> {
  const groupId = randomBytes(16).toString("base64url");

  const result = await prisma.$transaction(async (tx) => {
    const cap = new Capture();
    const rtx = makeClient(tx, cap, groupId);
    const bodyResult = await body(rtx);

    const ids = [...cap.kinds.keys()];
    if (ids.length > 0) {
      const afterRows = new Map<number, Row>();
      const raw = await tx.$queryRaw<Row[]>`
        SELECT * FROM Block WHERE id IN (${Prisma.join(ids)})
      `;
      for (const r of raw) {
        const row = normalizeBlockRow(r);
        afterRows.set(Number(row.id), row);
      }

      const rows: Prisma.BlockRevisionCreateManyInput[] = [];
      for (const id of ids) {
        const kind = cap.kinds.get(id)!;
        const before = cap.before.get(id) ?? null;
        const after = afterRows.get(id) ?? null;
        // Identita řádku se bere z toho stavu, který existuje — u DELETE z „před".
        const identity = (before ?? after) as Row | null;
        if (!identity) continue;

        let beforeJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
        let afterJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;

        if (kind === "CREATE" && after) {
          afterJson = after as Prisma.InputJsonValue;
        } else if (kind === "DELETE" && before) {
          beforeJson = before as Prisma.InputJsonValue;
        } else if (kind === "UPDATE" && before && after) {
          const diff = computeRevisionDiff(before, after);
          // Prázdný rozdíl = žádná revize. Výjimka: partial řádky se zapisují vždy.
          if (!diff && !cap.partial) continue;
          if (diff) {
            beforeJson = diff.before as Prisma.InputJsonValue;
            afterJson = diff.after as Prisma.InputJsonValue;
          }
        } else {
          continue;
        }

        rows.push({
          groupId,
          blockId: id,
          machine: String(identity.machine),
          orderNumber: identity.orderNumber == null ? null : String(identity.orderNumber),
          action: meta.action,
          kind,
          label: meta.label,
          userId: meta.user.id,
          username: meta.user.username,
          before: beforeJson,
          after: afterJson,
          rowVersion: (after?.updatedAt as Date | undefined) ?? null,
          partial: cap.partial,
        });
      }

      if (rows.length > 0) await tx.blockRevision.createMany({ data: rows });
    }

    return bodyResult;
  }, meta.txOptions ?? { timeout: 15000, maxWait: 5000 });

  return { result, groupId };
}
