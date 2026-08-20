import { test } from "node:test";
import assert from "node:assert/strict";
import { syncReservationScheduleForBlocks } from "./reservationSync.server";
import type { PrismaTransactionClient } from "./prismaTx";

type BlockRow = { id: number; reservationId: number | null; machine: string; startTime: Date; endTime: Date };
type ResRow = {
  id: number; scheduledBlockId: number | null; scheduledMachine: string | null;
  scheduledStartTime: Date | null; scheduledEndTime: Date | null;
};

const T = (h: number) => new Date(`2026-08-21T${String(h).padStart(2, "0")}:00:00.000Z`);

function mkTx(blocks: BlockRow[], reservations: ResRow[]) {
  const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const tx = {
    block: {
      // Fake promítá where (poučení P9): id in + reservationId not null.
      findMany: async (args: { where: { id: { in: number[] } } }) =>
        blocks.filter((b) => args.where.id.in.includes(b.id)),
    },
    reservation: {
      findMany: async (args: { where: { id: { in: number[] } } }) =>
        reservations.filter((r) => args.where.id.in.includes(r.id)),
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
  } as unknown as PrismaTransactionClient;
  return { tx, updates };
}

test("sync: posunutý blok s reservationId propíše scheduled* a vrátí id rezervace", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 7, scheduledMachine: "XL_106", scheduledStartTime: T(8), scheduledEndTime: T(10) }],
  );
  const changed = await syncReservationScheduleForBlocks(tx, [7]);
  assert.deepEqual(changed, [3]);
  assert.deepEqual(updates, [{ id: 3, data: { scheduledMachine: "XL_106", scheduledStartTime: T(10), scheduledEndTime: T(12) } }]);
});

test("sync: shodné hodnoty → žádný update (no-op)", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 7, scheduledMachine: "XL_106", scheduledStartTime: T(10), scheduledEndTime: T(12) }],
  );
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, [7]), []);
  assert.equal(updates.length, 0);
});

test("sync: stale link (scheduledBlockId ukazuje jinam) → rezervace se nesynchronizuje", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 99, scheduledMachine: "XL_105", scheduledStartTime: T(1), scheduledEndTime: T(2) }],
  );
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, [7]), []);
  assert.equal(updates.length, 0);
});

test("sync: bloky bez reservationId se odfiltrují, prázdný vstup je no-op", async () => {
  const { tx, updates } = mkTx(
    [{ id: 8, reservationId: null, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [],
  );
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, [8]), []);
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, []), []);
  assert.equal(updates.length, 0);
});

test("sync: duplikátní blockIds → jediný update", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 7, scheduledMachine: "XL_106", scheduledStartTime: T(8), scheduledEndTime: T(10) }],
  );
  await syncReservationScheduleForBlocks(tx, [7, 7, 7]);
  assert.equal(updates.length, 1);
});
