/**
 * Overlap guard probe — reálný DB souběhový/integrační test proti MySQL.
 *
 * Zavírá H2 mezeru z auditu overlap guardu: mock.fn testy nesimulují skutečný
 * MySQL row-locking (FOR UPDATE). Tento skript volá SKUTEČNÉ guard funkce
 * (assertNoOverlapForBlocks = trailing net s FOR UPDATE; resolveChainPushFromDb
 * = R4 „ne-ZAKAZKA jako pevná zeď") proti živé DB z DATABASE_URL.
 *
 * BEZPEČNÉ: každý scénář běží ve vlastní $transaction, kterou VŽDY na konci
 * rollbackneme (sentinel throw) → v DB nezůstane ani jeden testovací blok.
 * Testovací bloky jsou na dalekém datu (2030) a stroji XL_105.
 *
 * Spuštění (dev/staging DB — NE nutně destruktivní, ale pouštěj proti dev):
 *   npx tsx scripts/overlap-guard-probe.ts
 * Exit 0 = všech 6 scénářů prošlo (záruka drží).
 */
import { prisma } from "@/lib/prisma";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { resolveChainPushFromDb } from "@/lib/overlapResolver.server";
import { isAppError } from "@/lib/errors";

const M = "XL_105";
class Sentinel extends Error {}
const D = (h: string) => new Date(`2030-06-03T${h.includes(":") ? h : h + ":00"}:00.000Z`);

type Res = { label: string; pass: boolean; msg: string };
const results: Res[] = [];

async function mkBlock(tx: import("@prisma/client").Prisma.TransactionClient, on: string, off: string, type = "ZAKAZKA", ord = "PROBE") {
  return tx.block.create({ data: { orderNumber: ord, machine: M, type, startTime: D(on), endTime: D(off) } });
}

type Tx = import("@prisma/client").Prisma.TransactionClient;

async function expectNetThrows(label: string, make: (tx: Tx) => Promise<number[]>) {
  try {
    await prisma.$transaction(async (tx) => {
      const ids = await make(tx);
      await assertNoOverlapForBlocks(M, ids, tx);
      throw new Sentinel("NET_DID_NOT_THROW");
    });
    results.push({ label, pass: false, msg: "tx neočekávaně prošla" });
  } catch (e) {
    if (isAppError(e) && e.code === "OVERLAP") results.push({ label, pass: true, msg: e.message });
    else if (e instanceof Sentinel) results.push({ label, pass: false, msg: "❌ NET NEHODIL — překryv by prošel!" });
    else results.push({ label, pass: false, msg: `neočekávané: ${e}` });
  }
}

async function expectNetPasses(label: string, make: (tx: Tx) => Promise<number[]>) {
  try {
    await prisma.$transaction(async (tx) => {
      const ids = await make(tx);
      await assertNoOverlapForBlocks(M, ids, tx);
      throw new Sentinel("OK");
    });
  } catch (e) {
    if (e instanceof Sentinel) results.push({ label, pass: true, msg: "net správně povolil nepřekrývající se bloky" });
    else if (isAppError(e) && e.code === "OVERLAP") results.push({ label, pass: false, msg: "❌ net falešně odmítl nepřekrývající!" });
    else results.push({ label, pass: false, msg: `neočekávané: ${e}` });
  }
}

async function expectWall(label: string, wallType: string, wantWord: RegExp) {
  try {
    await prisma.$transaction(async (tx) => {
      await mkBlock(tx, "08", "10", wallType, `WALL-${wallType}`);
      const anchor = await mkBlock(tx, "08:30", "09:30", "ZAKAZKA", "ANCHOR");
      await resolveChainPushFromDb(tx, M, { id: anchor.id, startTime: anchor.startTime, endTime: anchor.endTime });
      throw new Sentinel("NO_CONFLICT");
    });
    results.push({ label, pass: false, msg: "tx neočekávaně prošla" });
  } catch (e) {
    if (isAppError(e) && e.code === "OVERLAP" && wantWord.test(e.message)) results.push({ label, pass: true, msg: e.message });
    else if (e instanceof Sentinel) results.push({ label, pass: false, msg: "❌ chain-push zeď nezafungovala!" });
    else if (isAppError(e)) results.push({ label, pass: false, msg: `OVERLAP ale špatná hláška: ${e.message}` });
    else results.push({ label, pass: false, msg: `neočekávané: ${e}` });
  }
}

async function main() {
  await expectNetThrows("1) net: ZAKAZKA × ZAKAZKA překryv", async (tx) => {
    const a = await mkBlock(tx, "08", "10", "ZAKAZKA", "Z-A");
    const b = await mkBlock(tx, "09", "11", "ZAKAZKA", "Z-B");
    return [a.id, b.id];
  });
  await expectNetThrows("2) net: ZAKAZKA × REZERVACE překryv (type-agnostic)", async (tx) => {
    const a = await mkBlock(tx, "08", "10", "ZAKAZKA", "Z");
    const b = await mkBlock(tx, "09", "11", "REZERVACE", "R");
    return [a.id, b.id];
  });
  await expectNetThrows("3) net: UDRZBA × UDRZBA překryv", async (tx) => {
    const a = await mkBlock(tx, "08", "10", "UDRZBA", "U-A");
    const b = await mkBlock(tx, "09", "11", "UDRZBA", "U-B");
    return [a.id, b.id];
  });
  await expectNetPasses("4) net: nepřekrývající se bloky (kontrola, není always-throw)", async (tx) => {
    const a = await mkBlock(tx, "08", "10", "ZAKAZKA", "OK-A");
    const b = await mkBlock(tx, "10", "12", "UDRZBA", "OK-B");
    return [a.id, b.id];
  });
  await expectWall("5) chain-push zeď: ZAKAZKA přes REZERVACE", "REZERVACE", /rezervac/i);
  await expectWall("6) chain-push zeď: ZAKAZKA přes UDRZBA", "UDRZBA", /údržb/i);

  await prisma.$disconnect();

  console.log("\n══════ OVERLAP GUARD PROBE (real MySQL) ══════");
  let ok = 0;
  for (const r of results) {
    console.log(`${r.pass ? "✅" : "❌"} ${r.label}\n     → ${r.msg}`);
    if (r.pass) ok++;
  }
  console.log(`\n${ok}/${results.length} scénářů prošlo. ${ok === results.length ? "ZÁRUKA DRŽÍ i proti reálné MySQL." : "!!! NĚCO NEPROŠLO !!!"}`);
  process.exit(ok === results.length ? 0 : 1);
}

main().catch((e) => { console.error("PROBE FAIL:", e); process.exit(2); });
