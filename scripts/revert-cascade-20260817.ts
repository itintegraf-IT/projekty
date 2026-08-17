/**
 * Jednorázová oprava incidentu 17. 8. 2026, 16:31 pražského času (14:31:07 UTC).
 *
 * CO SE STALO: `j.umlauf` posunul blok 1335 (zakázka 18424) na XL 105 o 30 minut.
 * Protože `l.lukes` šest minut předtím protáhl pondělní odpolední směnu do 24:00,
 * blok se po posunu přestal vejít před midnight — 30 z jeho 180 tiskových minut
 * přeteklo přes noční pauzu, konec skočil o 6,5 hodiny (24:00 → 6:30) a chain push
 * odsunul 87 navazujících bloků, některé až do poloviny září.
 *
 * PROČ SKRIPT A NE UNDO: undo v aplikaci kontroluje `expectedUpdatedAt` všech cílů
 * najednou a mezi 16:33 a 16:47 pracovali `mtz` a `f.fucik` na sedmi z nich.
 *
 * PROČ NE OBNOVA ZE ZÁLOHY: denní záloha je z noci, restore by zahodil celý den.
 * Přesné „před" hodnoty máme v `BlockRevision` — právě na tohle ta tabulka je.
 *
 * REŽIMY:
 *   npx tsx scripts/revert-cascade-20260817.ts            → DRY-RUN (nic nemění)
 *   npx tsx scripts/revert-cascade-20260817.ts --apply    → jedna transakce
 *
 * BEZPEČNOST:
 *  - před `--apply` VŽDY mysqldump (docs/DEPLOY_WORKFLOW.md) a `pm2 stop` aplikace,
 *    aby do toho nikdo nezapisoval;
 *  - skript NEZAPÍŠE NIC, pokud kterýkoli blok nestojí přesně tam, kam ho ta havárie
 *    posunula — tj. pokud ho mezitím někdo posunul, oprava se zastaví a vypíše který;
 *  - vše běží v JEDNÉ transakci uvnitř `withRevision`, takže oprava je sama v černé
 *    skříňce pod jedním `groupId`, a končí `assertNoOverlapForBlocks` — jakýkoli
 *    překryv znamená rollback všeho.
 */
import { prisma } from "@/lib/prisma";
import { withRevision } from "@/lib/revision.server";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";

/** Revizní skupina té jediné transakce, kterou vracíme (j.umlauf, 14:31:07 UTC). */
const GROUP_ID = "vTs4hxUgHhhtrzzsGj4IJg";

/**
 * Blok 18088 v té skupině NENÍ — Lukáš ho prodloužil až v 14:46:41 (revize 4994),
 * aby zaplnil půlhodinu uvolněnou j.umlaufovým posunem. Právě tu půlhodinu ale
 * potřebuje 18424, když se vrací na 19:00; bez vrácení 18088 by oprava skončila
 * překryvem. Vrací se tedy spolu s dávkou (rozhodl Vojta 17. 8. 2026).
 */
const EXTRA = {
  blockId: 1138,
  /** Cílový stav = `before` z revize 4994. */
  target: { endTime: new Date("2026-08-17T19:00:00.000Z"), printMinutes: 600 },
  /** Stav, ve kterém blok MUSÍ být, než na něj sáhneme = `after` z revize 4994. */
  expect: { endTime: new Date("2026-08-17T19:30:00.000Z"), printMinutes: 630 },
};

const APPLY = process.argv.includes("--apply");
const ACTOR = { id: 0, username: "system:revert-cascade" };

/** ISO span pro `AuditLog` — en-dash `–` (U+2013), NE ASCII pomlčka: `fmtAuditVal` podle něj pozná span. */
function span(start: Date, end: Date): string {
  return `${start.toISOString()}–${end.toISOString()}`;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

type Geom = { startTime: Date; endTime: Date };

/** Vytáhne geometrii z revizního JSONu. Chybějící pole = tvrdá chyba, ne tiché přeskočení. */
function geomOf(json: unknown, what: string, blockId: number): Geom {
  const o = json as Record<string, unknown> | null;
  const s = o?.startTime;
  const e = o?.endTime;
  if (typeof s !== "string" || typeof e !== "string") {
    throw new Error(
      `Revize bloku ${blockId}: v \`${what}\` chybí startTime/endTime — dávka není čistě poziční, ` +
      "oprava se musí navrhnout znovu ručně.",
    );
  }
  return { startTime: new Date(s), endTime: new Date(e) };
}

async function main() {
  console.log(`Režim: ${APPLY ? "APPLY (zapisuje!)" : "DRY-RUN (nic nemění)"}`);
  console.log(`Revizní skupina: ${GROUP_ID}\n`);

  const revs = await prisma.blockRevision.findMany({
    where: { groupId: GROUP_ID },
    select: { id: true, blockId: true, orderNumber: true, machine: true, kind: true, before: true, after: true },
    orderBy: { id: "asc" },
  });

  if (revs.length === 0) {
    throw new Error(`Skupina ${GROUP_ID} v BlockRevision není — zkontroluj groupId (retence je 90 dní).`);
  }
  const nonUpdate = revs.filter((r) => r.kind !== "UPDATE");
  if (nonUpdate.length > 0) {
    throw new Error(
      `Skupina obsahuje ${nonUpdate.length} řádků kind≠UPDATE (${nonUpdate.map((r) => `${r.blockId}:${r.kind}`).join(", ")}). ` +
      "Vznik/zánik bloku tenhle skript vracet neumí.",
    );
  }

  const targets = revs.map((r) => ({
    blockId: r.blockId,
    orderNumber: r.orderNumber,
    machine: r.machine,
    to: geomOf(r.before, "before", r.blockId),
    expect: geomOf(r.after, "after", r.blockId),
  }));

  // ── Pojistka: sedí současný stav DB na to, co ta havárie zapsala? ──────────
  const ids = [...targets.map((t) => t.blockId), EXTRA.blockId];
  const rows = await prisma.block.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
  });
  const byId = new Map(rows.map((b) => [b.id, b]));

  const missing: number[] = [];
  const drifted: string[] = [];

  for (const t of targets) {
    const cur = byId.get(t.blockId);
    if (!cur) {
      missing.push(t.blockId);
      continue;
    }
    if (
      cur.startTime.getTime() !== t.expect.startTime.getTime() ||
      cur.endTime.getTime() !== t.expect.endTime.getTime()
    ) {
      drifted.push(
        `  #${t.blockId} (${t.orderNumber ?? "?"}): v DB ${fmt(cur.startTime)}–${fmt(cur.endTime)}, ` +
        `čekáno ${fmt(t.expect.startTime)}–${fmt(t.expect.endTime)}`,
      );
    }
  }

  const extraCur = byId.get(EXTRA.blockId);
  if (!extraCur) {
    missing.push(EXTRA.blockId);
  } else if (
    extraCur.endTime.getTime() !== EXTRA.expect.endTime.getTime() ||
    extraCur.printMinutes !== EXTRA.expect.printMinutes
  ) {
    drifted.push(
      `  #${EXTRA.blockId} (${extraCur.orderNumber ?? "?"}): v DB konec ${fmt(extraCur.endTime)} / pm ${extraCur.printMinutes}, ` +
      `čekáno ${fmt(EXTRA.expect.endTime)} / pm ${EXTRA.expect.printMinutes}`,
    );
  }

  // ── Výpis návrhu ──────────────────────────────────────────────────────────
  for (const t of targets) {
    console.log(
      `${t.machine} #${t.blockId} ${(t.orderNumber ?? "?").padEnd(12)} ` +
      `${fmt(t.expect.startTime)}–${fmt(t.expect.endTime)}  →  ${fmt(t.to.startTime)}–${fmt(t.to.endTime)}`,
    );
  }
  console.log(
    `${extraCur?.machine ?? "XL_105"} #${EXTRA.blockId} ${(extraCur?.orderNumber ?? "18088").padEnd(12)} ` +
    `konec ${fmt(EXTRA.expect.endTime)} / pm ${EXTRA.expect.printMinutes}  →  ` +
    `${fmt(EXTRA.target.endTime)} / pm ${EXTRA.target.printMinutes}`,
  );

  console.log(`\nBloků k vrácení: ${targets.length} + 1 korekce (18088) = ${targets.length + 1}`);
  console.log(`Nesouladů: ${drifted.length}${missing.length > 0 ? `, chybějících bloků: ${missing.length}` : ""}`);

  if (missing.length > 0) {
    console.error(`\n❌ Bloky nenalezeny v DB: ${missing.join(", ")}. Nic se nezapsalo.`);
    process.exitCode = 1;
    return;
  }
  if (drifted.length > 0) {
    console.error("\n❌ Někdo s těmito bloky mezitím hnul — oprava by přepsala jeho práci:");
    drifted.forEach((d) => console.error(d));
    console.error("\nNic se nezapsalo. Projdi ty bloky ručně a rozhodni, co s nimi.");
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log("\n✅ Vše sedí. Spusť s --apply (po záloze a `pm2 stop`).");
    return;
  }

  // Po obou pojistkách výš je 18088 prokazatelně načtený — TS to z `missing.length`
  // neodvodí, takže se to říká znovu a bez `!` (nedosažitelná větev, ne přehlédnutí).
  const extra = byId.get(EXTRA.blockId);
  if (!extra) throw new Error(`Blok ${EXTRA.blockId} zmizel mezi kontrolou a zápisem.`);

  // ── Zápis ─────────────────────────────────────────────────────────────────
  // `txOptions` výslovně: 89 bloků × (update + zamykající čtení revize) + 89 dotazů
  // finální pojistky se do výchozích 15 s pomocníka nemusí vejít. Vzor: reflow stroje
  // (`src/app/api/blocks/reflow/route.ts`), jen s vyšším stropem — na skript nikdo nečeká.
  const { groupId } = await withRevision(
    {
      action: "UNDO",
      label: "Vrácení kaskády 16:31 — incident 17. 8. 2026",
      user: ACTOR,
      txOptions: { timeout: 120_000, maxWait: 10_000 },
    },
    async (rtx) => {
      for (const t of targets) {
        await rtx.block.update({
          where: { id: t.blockId },
          data: { startTime: t.to.startTime, endTime: t.to.endTime },
        });
      }
      await rtx.block.update({
        where: { id: EXTRA.blockId },
        data: { endTime: EXTRA.target.endTime, printMinutes: EXTRA.target.printMinutes },
      });

      await rtx.auditLog.createMany({
        data: [
          ...targets.map((t) => ({
            blockId: t.blockId,
            orderNumber: t.orderNumber,
            userId: ACTOR.id,
            username: ACTOR.username,
            action: "INCIDENT_REVERT",
            field: "startTime/endTime",
            oldValue: span(t.expect.startTime, t.expect.endTime),
            newValue: span(t.to.startTime, t.to.endTime),
          })),
          // Dva samostatné řádky, ne složené `field: "endTime/printMinutes"` —
          // `COMPOSITE_FIELDS` takový tvar nezná a pokrytí by ho vzalo za jméno
          // jednoho (neexistujícího) sloupce.
          {
            blockId: EXTRA.blockId,
            orderNumber: extra.orderNumber,
            userId: ACTOR.id,
            username: ACTOR.username,
            action: "INCIDENT_REVERT",
            field: "endTime",
            oldValue: EXTRA.expect.endTime.toISOString(),
            newValue: EXTRA.target.endTime.toISOString(),
          },
          {
            blockId: EXTRA.blockId,
            orderNumber: extra.orderNumber,
            userId: ACTOR.id,
            username: ACTOR.username,
            action: "INCIDENT_REVERT",
            field: "printMinutes",
            oldValue: String(EXTRA.expect.printMinutes),
            newValue: String(EXTRA.target.printMinutes),
          },
        ],
      });

      // Finální pojistka per stroj — parita s ostatními zápisovými cestami.
      // Průběžné překryvy uvnitř transakce jsou nevyhnutelné (bloky se vracejí na
      // pozice, které ještě drží jejich sousedi); rozhoduje až stav na konci.
      const byMachine = new Map<string, number[]>();
      for (const t of targets) {
        byMachine.set(t.machine, [...(byMachine.get(t.machine) ?? []), t.blockId]);
      }
      byMachine.set(extra.machine, [...(byMachine.get(extra.machine) ?? []), EXTRA.blockId]);
      for (const [machine, machineIds] of byMachine) {
        await assertNoOverlapForBlocks(machine, machineIds, rtx);
      }
    },
  );

  console.log(`\n✅ Provedeno. Revizní skupina opravy: ${groupId}`);
  console.log("Ověř: scripts/check-overlaps-new.sql, počítadlo driftu nad XL 105, oční kontrola 18.–22. 8.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
