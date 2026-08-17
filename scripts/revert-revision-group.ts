/**
 * Obecný nástroj pro vrácení revizní skupiny z `BlockRevision`.
 *
 * Zobecněná verze jednorázového skriptu `revert-cascade-20260817.ts`, kterým se
 * pod tlakem opravovala havárie 17. 8. 2026 v 16:31 (chain push odsunul 88 bloků,
 * undo v aplikaci nešlo použít kvůli `expectedUpdatedAt` konfliktu se souběžnou
 * prací). Mechanika je z toho skriptu doslova převzatá — jen `GROUP_ID`/`EXTRA`
 * zadrátované ve zdrojáku se vytáhly do argumentů příkazové řádky. Původní skript
 * ZŮSTÁVÁ nezměněný jako historický záznam incidentu; tenhle je nástroj pro
 * příště, ne náhrada.
 *
 * CO SKRIPT DĚLÁ:
 *  1) načte revize dané `--group` skupiny — cíl vrácení každého bloku je
 *     `before` z jeho revize (pozice, kterou blok měl PŘED tím, co skupina
 *     vznikla);
 *  2) ověří, že aktuální stav bloku v DB odpovídá `after` téže revize — pokud
 *     mezitím někdo s blokem hnul, oprava by přepsala jeho práci, a skript se
 *     zastaví BEZ ZÁPISU;
 *  3) simuluje cílový stav (co by bylo v DB, kdyby se vrácení provedlo) a
 *     nahlásí VŠECHNY kolize s bloky mimo dávku, ne jen první — bez toho se
 *     oprava ladí po jedné kolizi na běh (přesně to se stalo 17. 8. 2026);
 *  4) bez kolizí a bez `--apply` skončí (dry-run, nic se nezapíše, transakce se
 *     vůbec neotevře); s `--apply` zapíše v JEDNÉ transakci přes `withRevision`
 *     a na konci zavolá `assertNoOverlapForBlocks` — libovolný přetrvávající
 *     překryv znamená rollback všeho.
 *
 * `--also <blockId>:pole=hodnota[,pole=hodnota…]` — korekce bloku, který v dané
 * revizní skupině NENÍ, ale patří k opravě (v incidentu 16:31 šlo o blok 18088,
 * který dostal navazující úpravu 7 minut po havárii, aby zaplnil místo, jež
 * havárie uvolnila — bez jeho vrácení spolu s dávkou by oprava skončila
 * kolizí). Povolená pole: `startTime`, `endTime` (ISO datum), `printMinutes`
 * (kladné celé číslo). Guard pro `--also` blok NENÍ revize skupiny (v ní není)
 * — je to JEHO VLASTNÍ poslední revize v `BlockRevision`: blok musí stát přesně
 * tam, kam ho ta revize zapsala, jinak se skript zastaví stejně jako u bloků ze
 * skupiny. Bez jakékoli revize daný blok NEJDE bezpečně ošetřit — skript to
 * odmítne, ne aby tiše přepsal cizí práci bez pojistky.
 *
 * POUŽITÍ:
 *   npx tsx scripts/revert-revision-group.ts --group <groupId>                    → DRY-RUN
 *   npx tsx scripts/revert-revision-group.ts --group <groupId> --apply            → zápis
 *   npx tsx scripts/revert-revision-group.ts --group <groupId> \
 *     --also 1138:endTime=2026-08-17T19:00:00.000Z,printMinutes=600 [--apply]
 *
 * BEZPEČNOST (stejná jako originál, viz `docs/OPS_ZALOHY.md`):
 *  - před `--apply` VŽDY nejdřív `mysqldump` a `pm2 stop` aplikace, aby do toho
 *    nikdo nezapisoval;
 *  - skript NEZAPÍŠE NIC, pokud kterýkoli dotčený blok nestojí přesně tam, kam
 *    ho zapsala revize, ze které vychází guard;
 *  - vše běží v JEDNÉ transakci uvnitř `withRevision` (nová revizní skupina pro
 *    samotnou opravu) a končí `assertNoOverlapForBlocks`.
 */
import { prisma } from "@/lib/prisma";
import { withRevision } from "@/lib/revision.server";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";

/** Pole, která `--also` smí měnit. Stejná trojice jako u incidentu 16:31 (pozice + délka). */
const ALSO_FIELDS = ["startTime", "endTime", "printMinutes"] as const;
type AlsoField = (typeof ALSO_FIELDS)[number];
type AlsoValues = Partial<Record<AlsoField, Date | number>>;

type AlsoTarget = { blockId: number; fields: AlsoField[]; to: AlsoValues };

type Args = { group: string; also: AlsoTarget[]; apply: boolean };

function printHelp(): void {
  console.log(
    "Použití:\n" +
    "  npx tsx scripts/revert-revision-group.ts --group <groupId> [--apply]\n" +
    "  npx tsx scripts/revert-revision-group.ts --group <groupId> \\\n" +
    "    --also <blockId>:pole=hodnota[,pole=hodnota…] [--apply]\n\n" +
    "Bez --apply je běh vždy jen DRY-RUN (nic se nezapíše).\n" +
    "Povolená pole u --also: startTime, endTime (ISO datum), printMinutes (celé číslo).",
  );
}

function parseAlsoSpec(spec: string): AlsoTarget {
  const sep = spec.indexOf(":");
  if (sep < 0) {
    throw new Error(`--also "${spec}" musí mít tvar <blockId>:pole=hodnota[,pole=hodnota…].`);
  }
  const blockId = Number(spec.slice(0, sep));
  if (!Number.isInteger(blockId) || blockId <= 0) {
    throw new Error(`--also "${spec}": "${spec.slice(0, sep)}" není platné ID bloku.`);
  }
  const to: AlsoValues = {};
  const fields: AlsoField[] = [];
  for (const pair of spec.slice(sep + 1).split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) throw new Error(`--also "${spec}": část "${pair}" musí mít tvar pole=hodnota.`);
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    if (!(ALSO_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`--also "${spec}": pole "${key}" není povolené (jen ${ALSO_FIELDS.join(", ")}).`);
    }
    const field = key as AlsoField;
    if (field === "printMinutes") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--also "${spec}": printMinutes musí být kladné celé číslo, dostal jsem "${raw}".`);
      }
      to.printMinutes = n;
    } else {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`--also "${spec}": "${raw}" není platné ISO datum pro ${field}.`);
      }
      to[field] = d;
    }
    fields.push(field);
  }
  if (fields.length === 0) throw new Error(`--also "${spec}" neobsahuje žádné pole.`);
  return { blockId, fields, to };
}

function parseArgs(argv: string[]): Args {
  let group: string | undefined;
  const also: AlsoTarget[] = [];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--group") {
      group = argv[++i];
    } else if (a === "--also") {
      const spec = argv[++i];
      if (!spec) throw new Error("--also potřebuje hodnotu, viz --help.");
      also.push(parseAlsoSpec(spec));
    } else if (a === "--apply") {
      apply = true;
    } else {
      throw new Error(`Neznámý argument: "${a}". Nápověda: --help.`);
    }
  }
  if (!group) throw new Error("Chybí --group <groupId>. Nápověda: --help.");
  return { group, also, apply };
}

/** ISO span pro `AuditLog` — en-dash `–` (U+2013), NE ASCII pomlčka: `fmtAuditVal` podle něj pozná span. */
function span(start: Date, end: Date): string {
  return `${start.toISOString()}–${end.toISOString()}`;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function fmtVal(field: AlsoField, v: Date | number): string {
  return field === "printMinutes" ? `pm ${v}` : fmt(v as Date);
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

/** Vytáhne jen požadovaná pole z revizního JSONu bloku mimo skupinu (guard pro `--also`). */
function fieldsOf(json: unknown, fields: AlsoField[], what: string, blockId: number): AlsoValues {
  const o = json as Record<string, unknown> | null;
  const out: AlsoValues = {};
  for (const field of fields) {
    const v = o?.[field];
    if (field === "printMinutes") {
      if (typeof v !== "number") {
        throw new Error(`Revize bloku ${blockId}: v \`${what}\` chybí printMinutes.`);
      }
      out.printMinutes = v;
    } else {
      if (typeof v !== "string") {
        throw new Error(`Revize bloku ${blockId}: v \`${what}\` chybí ${field}.`);
      }
      out[field] = new Date(v);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Režim: ${args.apply ? "APPLY (zapisuje!)" : "DRY-RUN (nic nemění)"}`);
  console.log(`Revizní skupina: ${args.group}\n`);

  const revs = await prisma.blockRevision.findMany({
    where: { groupId: args.group },
    select: { id: true, blockId: true, orderNumber: true, machine: true, kind: true, before: true, after: true },
    orderBy: { id: "asc" },
  });

  if (revs.length === 0) {
    throw new Error(`Skupina "${args.group}" v BlockRevision není — zkontroluj groupId (retence je 90 dní).`);
  }
  const nonUpdate = revs.filter((r) => r.kind !== "UPDATE");
  if (nonUpdate.length > 0) {
    throw new Error(
      `Skupina obsahuje ${nonUpdate.length} řádků kind≠UPDATE (${nonUpdate.map((r) => `${r.blockId}:${r.kind}`).join(", ")}). ` +
      "Vznik/zánik bloku tenhle skript vracet neumí.",
    );
  }

  const groupTargets = revs.map((r) => ({
    blockId: r.blockId,
    orderNumber: r.orderNumber,
    machine: r.machine,
    to: geomOf(r.before, "before", r.blockId),
    expect: geomOf(r.after, "after", r.blockId),
  }));

  // ── Guard pro --also bloky: vlastní POSLEDNÍ revize daného bloku, ne skupina. ──
  const alsoWithExpect: Array<{
    blockId: number;
    fields: AlsoField[];
    to: AlsoValues;
    expect: AlsoValues;
  }> = [];
  for (const a of args.also) {
    const latest = await prisma.blockRevision.findFirst({
      where: { blockId: a.blockId, kind: "UPDATE" },
      select: { id: true, after: true },
      orderBy: { id: "desc" },
    });
    if (!latest) {
      throw new Error(
        `--also blok ${a.blockId} nemá v BlockRevision žádnou revizi — nejde ověřit, že mezitím ` +
        "nikdo nesáhl. Skript ho bez pojistky odmítá zpracovat.",
      );
    }
    alsoWithExpect.push({
      blockId: a.blockId,
      fields: a.fields,
      to: a.to,
      expect: fieldsOf(latest.after, a.fields, `after (revize #${latest.id})`, a.blockId),
    });
  }

  // ── Pojistka: sedí současný stav DB na to, co tam zapsala revize? ──────────
  const ids = [...groupTargets.map((t) => t.blockId), ...alsoWithExpect.map((t) => t.blockId)];
  const rows = await prisma.block.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
  });
  const byId = new Map(rows.map((b) => [b.id, b]));

  const missing: number[] = [];
  const drifted: string[] = [];

  for (const t of groupTargets) {
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

  for (const t of alsoWithExpect) {
    const cur = byId.get(t.blockId);
    if (!cur) {
      missing.push(t.blockId);
      continue;
    }
    for (const field of t.fields) {
      const expectVal = t.expect[field]!;
      const curVal = field === "printMinutes" ? cur.printMinutes : cur[field];
      const curTime = field === "printMinutes" ? curVal : (curVal as Date).getTime();
      const expectTime = field === "printMinutes" ? expectVal : (expectVal as Date).getTime();
      if (curTime !== expectTime) {
        drifted.push(
          `  #${t.blockId} (${cur.orderNumber ?? "?"}) [--also], pole ${field}: v DB ${
            curVal instanceof Date ? fmt(curVal) : curVal
          }, čekáno ${fmtVal(field, expectVal)}`,
        );
      }
    }
  }

  // ── Výpis návrhu ──────────────────────────────────────────────────────────
  for (const t of groupTargets) {
    console.log(
      `${t.machine} #${t.blockId} ${(t.orderNumber ?? "?").padEnd(12)} ` +
      `${fmt(t.expect.startTime)}–${fmt(t.expect.endTime)}  →  ${fmt(t.to.startTime)}–${fmt(t.to.endTime)}`,
    );
  }
  for (const t of alsoWithExpect) {
    const cur = byId.get(t.blockId);
    const changes = t.fields
      .map((f) => `${f}: ${fmtVal(f, t.expect[f]!)} → ${fmtVal(f, t.to[f]!)}`)
      .join(", ");
    console.log(`${cur?.machine ?? "?"} #${t.blockId} ${(cur?.orderNumber ?? "?").padEnd(12)} [--also] ${changes}`);
  }

  console.log(`\nBloků k vrácení: ${groupTargets.length} + ${alsoWithExpect.length} korekcí (--also)`);
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

  // ── Simulace cílového stavu: nekoliduje vrácení s něčím, co v dávce NENÍ? ──
  //
  // Druhá pojistka, přenesená beze změny logiky z originálu (vznikla z pokusu
  // 17. 8. 2026: první běh `--apply` spadl AŽ uvnitř transakce na kolizi, kterou
  // dry-run neohlásil dopředu, a to jen s první nalezenou kolizí, ne se všemi).
  const affectedMachines = new Set<string>();
  for (const t of groupTargets) affectedMachines.add(t.machine);
  for (const t of alsoWithExpect) {
    const machine = byId.get(t.blockId)?.machine;
    if (machine) affectedMachines.add(machine);
  }
  const machineBlocks = await prisma.block.findMany({
    where: { machine: { in: [...affectedMachines] } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true },
  });
  const groupToById = new Map(groupTargets.map((t) => [t.blockId, t.to]));
  const alsoById = new Map(alsoWithExpect.map((t) => [t.blockId, t.to]));

  /** Geometrie po opravě: blok z dávky/--also dostane cílová pole, ostatní zůstávají. */
  const simulated = machineBlocks.map((b) => {
    const groupTo = groupToById.get(b.id);
    if (groupTo) return { ...b, startTime: groupTo.startTime, endTime: groupTo.endTime };
    const alsoTo = alsoById.get(b.id);
    if (alsoTo) {
      return {
        ...b,
        startTime: (alsoTo.startTime as Date) ?? b.startTime,
        endTime: (alsoTo.endTime as Date) ?? b.endTime,
      };
    }
    return b;
  });

  const clashes: string[] = [];
  const touchedIds = new Set([...groupToById.keys(), ...alsoById.keys()]);
  for (const machine of affectedMachines) {
    const list = simulated.filter((b) => b.machine === machine).sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (b.startTime.getTime() >= a.endTime.getTime()) break; // seřazeno → dál už nic nekoliduje
        // Kolize dvou bloků, z nichž ANI JEDEN oprava nemění, je stará vada plánu —
        // ne něco, co bychom vyrobili my. Hlásí se odděleně, ať se nepletou.
        const touched = touchedIds.has(a.id) || touchedIds.has(b.id);
        clashes.push(
          `  ${touched ? "OPRAVA" : "starý"} ${machine}: #${a.id} ${a.orderNumber ?? "?"} ` +
          `(${fmt(a.startTime)}–${fmt(a.endTime)})  ×  #${b.id} ${b.orderNumber ?? "?"} (${fmt(b.startTime)}–${fmt(b.endTime)})`,
        );
      }
    }
  }

  if (clashes.length > 0) {
    console.error(`\n❌ Cílový stav by měl ${clashes.length} kolizí — oprava se NESPUSTÍ:`);
    clashes.forEach((c) => console.error(c));
    console.error(
      "\nNic se nezapsalo. U každé kolize se musí rozhodnout, který blok ustoupí " +
      "(typicky ten, který vznikl nebo se posunul PO vzniku skupiny do místa, které uvolnila).",
    );
    process.exitCode = 1;
    return;
  }

  if (!args.apply) {
    console.log("\n✅ Vše sedí, cílový stav je bez kolizí. Spusť s --apply (po záloze a `pm2 stop planovanivyroby`).");
    return;
  }

  // ── Zápis ─────────────────────────────────────────────────────────────────
  // `txOptions` výslovně: velké dávky × (update + zamykající čtení revize) + finální
  // pojistka se nemusí vejít do výchozích 15 s pomocníka. Vzor: reflow stroje
  // (`src/app/api/blocks/reflow/route.ts`), jen s vyšším stropem — na skript nikdo nečeká.
  const { groupId } = await withRevision(
    {
      action: "UNDO",
      label: `Vrácení revizní skupiny ${args.group}`,
      user: { id: 0, username: "system:revert-revision-group" },
      txOptions: { timeout: 120_000, maxWait: 10_000 },
    },
    async (rtx) => {
      for (const t of groupTargets) {
        await rtx.block.update({
          where: { id: t.blockId },
          data: { startTime: t.to.startTime, endTime: t.to.endTime },
        });
      }
      for (const t of alsoWithExpect) {
        const data: Record<string, Date | number> = {};
        for (const field of t.fields) data[field] = t.to[field]!;
        await rtx.block.update({ where: { id: t.blockId }, data });
      }

      await rtx.auditLog.createMany({
        data: [
          ...groupTargets.map((t) => ({
            blockId: t.blockId,
            orderNumber: t.orderNumber,
            userId: 0,
            username: "system:revert-revision-group",
            action: "INCIDENT_REVERT",
            field: "startTime/endTime",
            oldValue: span(t.expect.startTime, t.expect.endTime),
            newValue: span(t.to.startTime, t.to.endTime),
          })),
          // Jeden řádek na pole, ne složené `field: "endTime/printMinutes"` —
          // `COMPOSITE_FIELDS` takový tvar nezná a pokrytí by ho vzalo za jméno
          // jednoho (neexistujícího) sloupce.
          ...alsoWithExpect.flatMap((t) => {
            const cur = byId.get(t.blockId);
            return t.fields.map((field) => ({
              blockId: t.blockId,
              orderNumber: cur?.orderNumber ?? null,
              userId: 0,
              username: "system:revert-revision-group",
              action: "INCIDENT_REVERT",
              field,
              oldValue: field === "printMinutes" ? String(t.expect[field]) : (t.expect[field] as Date).toISOString(),
              newValue: field === "printMinutes" ? String(t.to[field]) : (t.to[field] as Date).toISOString(),
            }));
          }),
        ],
      });

      // Finální pojistka per stroj — parita s ostatními zápisovými cestami.
      // Průběžné překryvy uvnitř transakce jsou nevyhnutelné (bloky se vracejí na
      // pozice, které ještě drží jejich sousedi); rozhoduje až stav na konci.
      const byMachine = new Map<string, number[]>();
      for (const t of groupTargets) {
        byMachine.set(t.machine, [...(byMachine.get(t.machine) ?? []), t.blockId]);
      }
      for (const t of alsoWithExpect) {
        const machine = byId.get(t.blockId)?.machine;
        if (!machine) continue;
        byMachine.set(machine, [...(byMachine.get(machine) ?? []), t.blockId]);
      }
      for (const [machine, machineIds] of byMachine) {
        await assertNoOverlapForBlocks(machine, machineIds, rtx);
      }
    },
  );

  console.log(`\n✅ Provedeno. Revizní skupina opravy: ${groupId}`);
  console.log("Ověř: scripts/check-overlaps-new.sql, počítadlo driftu u dotčených strojů, oční kontrola v planneru.");
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
