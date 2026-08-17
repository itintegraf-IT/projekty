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
 * SKRIPT JE ČISTĚ POZIČNÍ A TVRDĚ TO VYNUCUJE. Vrací JEN `startTime`/`endTime`
 * (a u `--also-revision` navíc `printMinutes`). Revizní skupina, kde `before`/
 * `after` některého bloku obsahuje i jiné pole (typicky `machine` — lasso batch
 * přesun mezi stroji), se ODMÍTNE CELÁ: kdyby skript takový blok tiše vrátil jen
 * pozičně, `assertNoOverlapForBlocks` na konci by kontroloval kolize na ŠPATNÉM
 * stroji (stroj z revize je ten PŘED přesunem) a mohl by nahlásit úspěch nad
 * tichým překryvem na produkci. Takovou dávku je nutné navrhnout ručně. Revize,
 * která mění jen JEDNO z obou polí (typicky čistý resize konce beze změny
 * startu), je STEJNĚ čistě poziční jako ta, co mění obě — skript to tak i
 * zpracuje (fix round finální recenze, M7: dřívější `geomOf` takovou revizi
 * omylem odmítal jako „není čistě poziční").
 *
 * CO SKRIPT DĚLÁ:
 *  1) načte revize dané `--group` skupiny — cíl vrácení každého bloku je
 *     `before` z jeho revize (pozice, kterou blok měl PŘED tím, co skupina
 *     vznikla);
 *  2) ověří, že aktuální stav bloku v DB — VČETNĚ stroje, na kterém dnes stojí —
 *     odpovídá `after` téže revize — pokud mezitím někdo s blokem hnul (jinam
 *     v čase, nebo i na JINÝ STROJ), oprava by přepsala jeho práci, a skript se
 *     zastaví BEZ ZÁPISU. Tahle kontrola běží DVAKRÁT: jednou před otevřením
 *     transakce (ať dry-run i apply vidí problém dřív, než se čeká na zámky),
 *     a znovu jako PRVNÍ dotaz UVNITŘ transakce — a to ZAMYKAJÍCÍ (`SELECT ...
 *     FOR UPDATE` nad všemi dotčenými bloky, `fetchRowsLocked`, vzor
 *     `undoApply.server.ts`). Obyčejný `findMany` by pod MySQL REPEATABLE READ
 *     bral jen konzistentní čtení bez zámku, takže „první dotaz" beze zámku by
 *     okno mezi kontrolou a zápisem NEZAVŘEL — cizí commit by mezitím proklouzl
 *     beze stopy;
 *  3) simuluje cílový stav (co by bylo v DB, kdyby se vrácení provedlo) a
 *     nahlásí VŠECHNY kolize s bloky mimo dávku, ne jen první — bez toho se
 *     oprava ladí po jedné kolizi na běh (přesně to se stalo 17. 8. 2026);
 *  4) bez kolizí a bez `--apply` skončí (dry-run, nic se nezapíše, transakce se
 *     vůbec neotevře); s `--apply` zapíše v JEDNÉ transakci přes `withRevision`
 *     a na konci zavolá `assertNoOverlapForBlocks` — libovolný přetrvávající
 *     překryv znamená rollback všeho.
 *
 * `--also-revision <revisionId>` — korekce bloku, který v dané revizní skupině
 * NENÍ, ale patří k opravě (v incidentu 16:31 šlo o blok 18088, který dostal
 * navazující úpravu 7 minut po havárii, aby zaplnil místo, jež havárie
 * uvolnila — bez jeho vrácení spolu s dávkou by oprava skončila kolizí). Cíl
 * a guard se ČTOU z uvedené revize (`before`/`after`), stejně jako u skupiny —
 * žádné ruční psaní ISO časů, to je jediné místo, kde by překlep zapsal nesmysl
 * rovnou do produkce. Revize musí být:
 *   - `kind: "UPDATE"`,
 *   - POSLEDNÍ `UPDATE` revize daného bloku (jinak nejde vyloučit, že blok od
 *     ní dál změnil ještě něco jiného — skript to neodhaduje, odmítne),
 *   - čistě poziční (jen `startTime`/`endTime`/`printMinutes`),
 *   - blok nesmí být zároveň součástí `--group` skupiny (duplicita cíle).
 *
 * `--allow-preexisting-overlaps` — bez ní skript odmítne spustit, i když
 * najde kolizi mezi dvěma bloky, které OPRAVA VŮBEC NEMĚNÍ (stará vada plánu,
 * kterou objevila jen simulace). S přepínačem se taková STARÁ kolize jen
 * nahlásí a přeskočí; kolize, kterou by ZPŮSOBILA samotná oprava, blokuje
 * VŽDY a přepínač na ni nemá vliv.
 *
 * POUŽITÍ:
 *   npx tsx scripts/revert-revision-group.ts --group <groupId>                    → DRY-RUN
 *   npx tsx scripts/revert-revision-group.ts --group <groupId> --apply            → zápis
 *   npx tsx scripts/revert-revision-group.ts --group <groupId> \
 *     --also-revision 4994 [--apply]
 *
 * BEZPEČNOST (stejná jako originál, viz `docs/OPS_ZALOHY.md`):
 *  - před `--apply` VŽDY nejdřív `mysqldump` a `pm2 stop` aplikace, aby do toho
 *    nikdo nezapisoval — kontrola uvnitř transakce (bod 2 výš) chrání proti
 *    souběhu, ne proti tomu, že se opravuje špatná dávka;
 *  - skript NEZAPÍŠE NIC, pokud kterýkoli dotčený blok nestojí přesně tam, kam
 *    ho zapsala revize, ze které vychází guard;
 *  - vše běží v JEDNÉ transakci uvnitř `withRevision` (vznikne NOVÁ revizní
 *    skupina pro samotnou opravu) a končí `assertNoOverlapForBlocks`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRevision } from "@/lib/revision.server";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import type { PrismaTransactionClient } from "@/lib/prismaTx";

/** Pole, která smí vracet skupina i `--also-revision`. */
const POSITIONAL = new Set(["startTime", "endTime"]);
/** `--also-revision` navíc smí vracet délku — revize 4994 v incidentu 16:31 ji nesla spolu s endTime. */
const ALSO_FIELDS = ["startTime", "endTime", "printMinutes"] as const;
type AlsoField = (typeof ALSO_FIELDS)[number];
type FieldValues = Partial<Record<AlsoField, Date | number>>;

type Args = {
  group: string;
  alsoRevisionIds: number[];
  apply: boolean;
  allowPreexistingOverlaps: boolean;
};

function printHelp(): void {
  console.log(
    "Použití:\n" +
    "  npx tsx scripts/revert-revision-group.ts --group <groupId> [--apply]\n" +
    "  npx tsx scripts/revert-revision-group.ts --group <groupId> \\\n" +
    "    --also-revision <revisionId> [--also-revision <revisionId> …] [--apply]\n" +
    "    [--allow-preexisting-overlaps]\n\n" +
    "Bez --apply je běh vždy jen DRY-RUN (nic se nezapíše, transakce se neotevře).\n" +
    "--also-revision musí ukazovat na POSLEDNÍ UPDATE revizi daného bloku a smí\n" +
    "měnit jen startTime/endTime/printMinutes.\n" +
    "--allow-preexisting-overlaps povolí spuštění i přes kolize, které oprava\n" +
    "nezpůsobuje (stará vada plánu) — kolize ZPŮSOBENÉ opravou blokují vždy.",
  );
}

function parseArgs(argv: string[]): Args {
  let group: string | undefined;
  const alsoRevisionIds: number[] = [];
  let apply = false;
  let allowPreexistingOverlaps = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--group") {
      group = argv[++i];
    } else if (a === "--also-revision") {
      const raw = argv[++i];
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`--also-revision "${raw}" není platné ID revize.`);
      }
      alsoRevisionIds.push(id);
    } else if (a === "--apply") {
      apply = true;
    } else if (a === "--allow-preexisting-overlaps") {
      allowPreexistingOverlaps = true;
    } else {
      throw new Error(`Neznámý argument: "${a}". Nápověda: --help.`);
    }
  }
  if (!group) throw new Error("Chybí --group <groupId>. Nápověda: --help.");
  return { group, alsoRevisionIds, apply, allowPreexistingOverlaps };
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

/** Jeden auditní řádek na pole — sdílené `groupTargets` (jednopolní cíl, M7) i `alsoTargets`. */
function incidentRevertFieldRow(
  t: { blockId: number; orderNumber: string | null; to: FieldValues; expect: FieldValues },
  field: AlsoField,
) {
  return {
    blockId: t.blockId,
    orderNumber: t.orderNumber,
    userId: 0,
    username: "system:revert-revision-group",
    action: "INCIDENT_REVERT",
    field,
    oldValue: field === "printMinutes" ? String(t.expect[field]) : (t.expect[field] as Date).toISOString(),
    newValue: field === "printMinutes" ? String(t.to[field]) : (t.to[field] as Date).toISOString(),
  };
}

/**
 * Sjednocené klíče `before`∪`after` revize (M6/M7 fix). `computeRevisionDiff`
 * (`src/lib/revision/diff.ts`) páruje obě strany na STEJNÝ klíčový set, takže union
 * je dnes ekvivalentní samotnému `before`, ale sdílená funkce to nemá potřebu
 * předpokládat napořád — používá ji jak validace čistoty (skupina i `--also-revision`),
 * tak stavba cíle, jedno místo pravdy místo dvou nezávislých výpočtů, co se časem
 * rozejdou (M6, dřív skupina koukala jen do `before`).
 */
function positionalFieldsOf(before: unknown, after: unknown): string[] {
  const beforeKeys = Object.keys((before ?? {}) as Record<string, unknown>);
  const afterKeys = Object.keys((after ?? {}) as Record<string, unknown>);
  return [...new Set([...beforeKeys, ...afterKeys])];
}

/** Vytáhne jen požadovaná pole z revizního JSONu (guard/cíl pro `--also-revision`). */
function fieldsOf(json: unknown, fields: AlsoField[], what: string, blockId: number): FieldValues {
  const o = json as Record<string, unknown> | null;
  const out: FieldValues = {};
  for (const field of fields) {
    const v = o?.[field];
    if (field === "printMinutes") {
      if (typeof v !== "number") throw new Error(`Revize bloku ${blockId}: v \`${what}\` chybí printMinutes.`);
      out.printMinutes = v;
    } else {
      if (typeof v !== "string") throw new Error(`Revize bloku ${blockId}: v \`${what}\` chybí ${field}.`);
      out[field] = new Date(v);
    }
  }
  return out;
}

/** Stejný tvar jako `AlsoTarget` (M7): skupina i `--also-revision` teď obě podporují
 *  cíl s jedním nebo dvěma poličky (`fields`), ne pevnou dvojici start+end. */
type GroupTarget = {
  blockId: number;
  orderNumber: string | null;
  machine: string;
  fields: AlsoField[];
  to: FieldValues;
  expect: FieldValues;
};

type AlsoTarget = {
  blockId: number;
  orderNumber: string | null;
  machine: string;
  fields: AlsoField[];
  to: FieldValues;
  expect: FieldValues;
};

/** Načte a ověří jednu `--also-revision`: existuje, je UPDATE, je POSLEDNÍ pro svůj blok, je čistě poziční. */
async function buildAlsoTarget(revisionId: number): Promise<AlsoTarget> {
  const rev = await prisma.blockRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, blockId: true, orderNumber: true, machine: true, kind: true, before: true, after: true },
  });
  if (!rev) throw new Error(`--also-revision ${revisionId}: revize v BlockRevision neexistuje.`);
  if (rev.kind !== "UPDATE") {
    throw new Error(
      `--also-revision ${revisionId}: kind=${rev.kind}, ne UPDATE — vznik/zánik bloku tenhle skript vracet neumí.`,
    );
  }

  const latest = await prisma.blockRevision.findFirst({
    where: { blockId: rev.blockId, kind: "UPDATE" },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (!latest || latest.id !== rev.id) {
    throw new Error(
      `--also-revision ${revisionId}: není poslední UPDATE revizí bloku ${rev.blockId} (poslední je ` +
      `#${latest?.id ?? "?"}). Mezi ní a teď mohl blok změnit ještě něco jiného — skript to neodhaduje, ` +
      "zadej poslední revizi nebo navrhni opravu ručně.",
    );
  }

  const allKeys = positionalFieldsOf(rev.before, rev.after);
  const impureKeys = allKeys.filter((k) => !(ALSO_FIELDS as readonly string[]).includes(k));
  if (impureKeys.length > 0) {
    throw new Error(
      `--also-revision ${revisionId}: revize bloku ${rev.blockId} mění i pole mimo pozici/délku ` +
      `(${impureKeys.join(", ")}) — skript vrací jen startTime/endTime/printMinutes, tohle se musí navrhnout ručně.`,
    );
  }
  const fields = allKeys as AlsoField[];
  if (fields.length === 0) {
    throw new Error(`--also-revision ${revisionId}: revize bloku ${rev.blockId} nemá žádný rozdíl v before/after.`);
  }

  return {
    blockId: rev.blockId,
    orderNumber: rev.orderNumber,
    machine: rev.machine,
    fields,
    to: fieldsOf(rev.before, fields, `before (revize #${rev.id})`, rev.blockId),
    expect: fieldsOf(rev.after, fields, `after (revize #${rev.id})`, rev.blockId),
  };
}

type DbRow = {
  id: number;
  orderNumber: string | null;
  machine: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
};

/**
 * Ověří JEDEN cíl (skupinu i `--also-revision` — od M7 stejný tvar dat):
 *  1) blok musí v DB existovat,
 *  2) MUSÍ dnes stát na stroji, ze kterého revize vychází (Important 1, fix round
 *     finální recenze). Bez týhle kontroly blok, který mezitím někdo přesunul na jiný
 *     stroj, `checkGuard` vůbec „nevidí" — `affectedMachines`/simulace o něm neví nic,
 *     dry-run by nahlásil „✅ Vše sedí" a teprve `assertNoOverlapForBlocks` uvnitř
 *     transakce by `--apply` odmítl nesrozumitelným pádem,
 *  3) každé jeho poziční pole (jedno nebo dvě, `t.fields` — M7: revize nemusí měnit
 *     start i konec zároveň) musí v DB sedět na `expect`.
 */
function checkTarget(
  cur: DbRow | undefined,
  t: { blockId: number; orderNumber: string | null; machine: string; fields: AlsoField[]; expect: FieldValues },
  tag: string,
  missing: number[],
  drifted: string[],
): void {
  if (!cur) {
    missing.push(t.blockId);
    return;
  }
  if (cur.machine !== t.machine) {
    drifted.push(
      `  #${t.blockId} (${t.orderNumber ?? "?"})${tag}: dnes stojí na stroji ${cur.machine}, oprava ` +
      `vychází ze stroje ${t.machine} — blok mezitím někdo přesunul na jiný stroj, oprava se musí navrhnout ručně.`,
    );
    return;
  }
  const mismatches: string[] = [];
  for (const field of t.fields) {
    const expectVal = t.expect[field]!;
    const curVal = field === "printMinutes" ? cur.printMinutes : cur[field];
    const curTime = field === "printMinutes" ? curVal : (curVal as Date).getTime();
    const expectTime = field === "printMinutes" ? expectVal : (expectVal as Date).getTime();
    if (curTime !== expectTime) {
      mismatches.push(`${field}: v DB ${curVal instanceof Date ? fmt(curVal) : curVal}, čekáno ${fmtVal(field, expectVal)}`);
    }
  }
  if (mismatches.length > 0) {
    drifted.push(`  #${t.blockId} (${t.orderNumber ?? "?"})${tag}: ${mismatches.join(", ")}`);
  }
}

/** Guard: sedí `byId` (aktuální stav) na `expect` (co tam podle revizí má být)? Volá se DVAKRÁT — viz hlavička. */
function checkGuard(
  byId: Map<number, DbRow>,
  groupTargets: GroupTarget[],
  alsoTargets: AlsoTarget[],
): { missing: number[]; drifted: string[] } {
  const missing: number[] = [];
  const drifted: string[] = [];
  for (const t of groupTargets) checkTarget(byId.get(t.blockId), t, "", missing, drifted);
  for (const t of alsoTargets) checkTarget(byId.get(t.blockId), t, " [--also-revision]", missing, drifted);
  return { missing, drifted };
}

/** `prisma` (plain klient) i `rtx` (transakční delegát z `withRevision`) mají shodný tvar `block.findMany`. */
async function fetchRows(client: typeof prisma | PrismaTransactionClient, ids: number[]): Promise<Map<number, DbRow>> {
  const rows = await client.block.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
  });
  return new Map(rows.map((b) => [b.id, b]));
}

/**
 * Zamykající čtení — MUSÍ být PRVNÍ dotaz v transakci (vzor `undoApply.server.ts`,
 * kolem řádku 169–183; pravidlo je i v `CLAUDE.md`). Obyčejný `findMany` je pod MySQL
 * REPEATABLE READ jen consistent read (nebere zámky) — mezi ním a zápisem by mohl
 * vklouznout souběžný commit odjinud a `checkGuard` by ho vůbec neviděl (přesně tahle
 * mezera se ukázala v re-review fix roundu 1: `fetchRows(rtx, …)` volané jako "první
 * dotaz" bylo pořád jen nezamykající čtení). `SELECT ... FOR UPDATE` bere per-row
 * X-zámky nad VŠEMI dotčenými bloky najednou — u vícebllokové dávky (havárie měla 88)
 * by zamykání po jednom nechalo otevřené okno mezi zámkem prvního a posledního bloku.
 * Vybírá záměrně jen `id`: zamyká celý řádek bez ohledu na to, co je v SELECT listu,
 * a skutečná data načte hned pod tím normální typovaný `findMany` (`fetchRows`) —
 * konzistentní read hned po zamykajícím čtení uvidí přesně to, co jsme právě zamkli.
 */
async function fetchRowsLocked(rtx: PrismaTransactionClient, ids: number[]): Promise<Map<number, DbRow>> {
  await rtx.$queryRaw`SELECT id FROM Block WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
  return fetchRows(rtx, ids);
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
  // C1: skupina musí být ČISTĚ POZIČNÍ. Když revize mění i `machine` (typicky lasso batch
  // přesun mezi stroji), `t.machine` z BlockRevision je stroj PŘED přesunem — kdyby skript
  // vrátil jen pozici, `assertNoOverlapForBlocks` by na konci kontroloval kolize na ŠPATNÉM
  // (starém) stroji a nahlásil by úspěch nad tichým překryvem na tom novém. Radši odmítnout
  // celou dávku, než riskovat tichý překryv na produkci po běhu, který hlásil úspěch.
  // M6: union `before`∪`after` přes `positionalFieldsOf`, sdílené s `buildAlsoTarget` —
  // dřív se tu koukalo jen do `before` (dnes ekvivalentní, `computeRevisionDiff` páruje
  // obě strany na stejný klíčový set, ale nemá to smysl předpokládat navždy).
  const revKeys = revs.map((r) => ({ r, keys: positionalFieldsOf(r.before, r.after) }));
  const impure = revKeys.filter(({ keys }) => keys.some((k) => !POSITIONAL.has(k)));
  if (impure.length > 0) {
    throw new Error(
      `Skupina není čistě poziční — bloky ${impure.map(({ r }) => r.blockId).join(", ")} mají v revizi ` +
      "i jiná pole než startTime/endTime (typicky machine nebo printMinutes). Skript vrací POUZE " +
      "pozici; vrácení stroje/délky se musí navrhnout ručně.",
    );
  }

  // M7: `fields` je jedno nebo dvě poziční pole podle toho, co revize SKUTEČNĚ měnila —
  // čistý resize konce (jen `endTime`) je stejně čistě poziční jako přesun (obě pole).
  const groupTargets: GroupTarget[] = revKeys.map(({ r, keys }) => {
    const fields = keys as AlsoField[];
    // Stejný guard jako `buildAlsoTarget` (ř. 263) — `partial` capture ve `withRevision`
    // (`src/lib/revision.server.ts:581`) zapíše revizní řádek i beze změny, takže prázdná
    // revize v DB reálně existuje. Bez tohoto guardu by takový cíl prošel čistotou i
    // `checkTarget` (nemá co porovnávat) a `--apply` by udělal `rtx.block.update({ data: {} })` —
    // tichý bump `Block.updatedAt` (`@updatedAt`) bez auditu a bez revize, který rozbije
    // cizí `expectedUpdatedAt`.
    if (fields.length === 0) {
      throw new Error(
        `Revize #${r.id} bloku ${r.blockId} nemá žádný rozdíl v before/after — skript neví, co vrátit, ` +
        "a odmítá to.",
      );
    }
    return {
      blockId: r.blockId,
      orderNumber: r.orderNumber,
      machine: r.machine,
      fields,
      to: fieldsOf(r.before, fields, `before (revize #${r.id})`, r.blockId),
      expect: fieldsOf(r.after, fields, `after (revize #${r.id})`, r.blockId),
    };
  });

  // ── --also-revision: načíst, ověřit (poslední UPDATE revize bloku, čistě poziční). ──
  const alsoTargets: AlsoTarget[] = [];
  for (const revisionId of args.alsoRevisionIds) {
    alsoTargets.push(await buildAlsoTarget(revisionId));
  }

  // I3: žádná duplicita a žádný průnik se skupinou — jinak by dry-run ověřoval jiný stav,
  // než jaký by se nakonec zapsal (simulace by dala přednost jednomu zdroji, zápis druhému).
  const groupIds = new Set(groupTargets.map((t) => t.blockId));
  const seenAlso = new Set<number>();
  for (const t of alsoTargets) {
    if (seenAlso.has(t.blockId)) {
      throw new Error(`--also-revision uvádí blok ${t.blockId} víc než jednou.`);
    }
    seenAlso.add(t.blockId);
    if (groupIds.has(t.blockId)) {
      throw new Error(
        `--also-revision uvádí blok ${t.blockId}, který už je součástí revizní skupiny "${args.group}" — ` +
        "je to duplicita cíle, ne doplněk.",
      );
    }
  }

  // ── Pojistka #1 (mimo transakci): sedí současný stav DB na to, co tam zapsala revize? ──
  const ids = [...groupIds, ...seenAlso];
  const byId = await fetchRows(prisma, ids);
  const { missing, drifted } = checkGuard(byId, groupTargets, alsoTargets);

  // ── Výpis návrhu ──────────────────────────────────────────────────────────
  // M7: skupinový cíl může mít jedno i dvě poziční pole (`fields`) — pro obvyklý
  // dvoupolní případ (přesun) se drží čitelnější „span → span" tvar, pro jednopolní
  // (čistý resize) se vypíše jen to jedno pole, stejně jako u `--also-revision`.
  for (const t of groupTargets) {
    const changes = (t.fields.length === 2 && t.fields.includes("startTime") && t.fields.includes("endTime"))
      ? `${fmt(t.expect.startTime as Date)}–${fmt(t.expect.endTime as Date)}  →  ${fmt(t.to.startTime as Date)}–${fmt(t.to.endTime as Date)}`
      : t.fields.map((f) => `${f}: ${fmtVal(f, t.expect[f]!)} → ${fmtVal(f, t.to[f]!)}`).join(", ");
    console.log(`${t.machine} #${t.blockId} ${(t.orderNumber ?? "?").padEnd(12)} ${changes}`);
  }
  for (const t of alsoTargets) {
    const changes = t.fields.map((f) => `${f}: ${fmtVal(f, t.expect[f]!)} → ${fmtVal(f, t.to[f]!)}`).join(", ");
    console.log(`${t.machine} #${t.blockId} ${(t.orderNumber ?? "?").padEnd(12)} [--also-revision] ${changes}`);
  }

  console.log(`\nBloků k vrácení: ${groupTargets.length} + ${alsoTargets.length} korekcí (--also-revision)`);
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
  for (const t of alsoTargets) affectedMachines.add(t.machine);
  const machineBlocks = await prisma.block.findMany({
    where: { machine: { in: [...affectedMachines] } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true },
  });
  const groupToById = new Map(groupTargets.map((t) => [t.blockId, t.to]));
  const alsoToById = new Map(alsoTargets.map((t) => [t.blockId, t.to]));

  /** Geometrie po opravě: blok z dávky/--also-revision dostane cílová pole, ostatní
   *  zůstávají — u obou zdrojů (M7) může chybět jedno z polí (čistý resize), pak
   *  zůstává současná hodnota bloku (`b.startTime`/`b.endTime`), ne nedefinováno. */
  const simulated = machineBlocks.map((b) => {
    const groupTo = groupToById.get(b.id);
    if (groupTo) {
      return {
        ...b,
        startTime: (groupTo.startTime as Date) ?? b.startTime,
        endTime: (groupTo.endTime as Date) ?? b.endTime,
      };
    }
    const alsoTo = alsoToById.get(b.id);
    if (alsoTo) {
      return {
        ...b,
        startTime: (alsoTo.startTime as Date) ?? b.startTime,
        endTime: (alsoTo.endTime as Date) ?? b.endTime,
      };
    }
    return b;
  });

  const touchedIds = new Set([...groupToById.keys(), ...alsoToById.keys()]);
  const touchedClashes: string[] = [];
  const untouchedClashes: string[] = [];
  for (const machine of affectedMachines) {
    const list = simulated.filter((b) => b.machine === machine).sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (b.startTime.getTime() >= a.endTime.getTime()) break; // seřazeno → dál už nic nekoliduje
        const touched = touchedIds.has(a.id) || touchedIds.has(b.id);
        const line =
          `  ${touched ? "OPRAVA" : "starý"} ${machine}: #${a.id} ${a.orderNumber ?? "?"} ` +
          `(${fmt(a.startTime)}–${fmt(a.endTime)})  ×  #${b.id} ${b.orderNumber ?? "?"} (${fmt(b.startTime)}–${fmt(b.endTime)})`;
        (touched ? touchedClashes : untouchedClashes).push(line);
      }
    }
  }

  if (touchedClashes.length > 0) {
    console.error(`\n❌ Cílový stav by měl ${touchedClashes.length} kolizí, které ZPŮSOBUJE tato oprava — NESPUSTÍ se:`);
    touchedClashes.forEach((c) => console.error(c));
    if (untouchedClashes.length > 0) {
      console.error(`\n(Navíc ${untouchedClashes.length} starých kolizí, které oprava nezpůsobuje — ty se řeší až po vyřešení výše.)`);
    }
    console.error(
      "\nNic se nezapsalo. U každé kolize se musí rozhodnout, který blok ustoupí " +
      "(typicky ten, který vznikl nebo se posunul PO vzniku skupiny do místa, které uvolnila).",
    );
    process.exitCode = 1;
    return;
  }
  if (untouchedClashes.length > 0 && !args.allowPreexistingOverlaps) {
    console.error(`\n❌ Cílový stav by měl ${untouchedClashes.length} STARÝCH kolizí (žádnou z nich tato oprava nezpůsobuje):`);
    untouchedClashes.forEach((c) => console.error(c));
    console.error(
      "\nNic se nezapsalo. Buď je to skutečná vada plánu k řešení zvlášť, nebo o ní víš a chceš " +
      "opravu pustit i tak — pak přidej --allow-preexisting-overlaps (jen přeskočí tuhle hlášku, " +
      "kolize samotné neopraví ani nezakryje).",
    );
    process.exitCode = 1;
    return;
  }
  if (untouchedClashes.length > 0) {
    console.log(`\n⚠ Ignoruji ${untouchedClashes.length} starých kolizí (--allow-preexisting-overlaps).`);
  }

  if (!args.apply) {
    console.log("\n✅ Vše sedí, cílový stav je bez nových kolizí. Spusť s --apply (po záloze a `pm2 stop planovanivyroby`).");
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
    async (rtx: PrismaTransactionClient) => {
      // I2 (TOCTOU): Pojistka #1 běžela v autocommitu PŘED otevřením transakce — mezitím
      // (čekání na zámek, souběžná práce) mohl kdokoli mimo skript kterýkoli dotčený blok
      // změnit. Zopakovat guard jako PRVNÍ dotaz uvnitř transakce, a to ZAMYKAJÍCÍ —
      // obyčejný `findMany` by pod REPEATABLE READ jen viděl bez zámku (re-review fix
      // roundu 1 to označilo jako zbývající mezeru: „první dotaz" beze zámku okno
      // nezavírá). `fetchRowsLocked` bere `SELECT ... FOR UPDATE` nad VŠEMI dotčenými
      // bloky jako doslova první dotaz v těle. Při neshodě throw → transakce se odrolí.
      const freshById = await fetchRowsLocked(rtx, ids);
      const recheck = checkGuard(freshById, groupTargets, alsoTargets);
      if (recheck.missing.length > 0 || recheck.drifted.length > 0) {
        throw new Error(
          "Stav bloků se změnil mezi kontrolou a otevřením transakce (souběžná editace) — " +
          "nic se nezapsalo. Spusť skript znovu, ať se ověří proti aktuálnímu stavu.",
        );
      }

      // M7: zápis podle `t.fields`, ne pevné dvojice — skupinový cíl s jedním polem
      // (čistý resize) zapíše jen to pole, stejně jako `--also-revision` odjakživa.
      for (const t of [...groupTargets, ...alsoTargets]) {
        const data: Record<string, Date | number> = {};
        for (const field of t.fields) data[field] = t.to[field]!;
        await rtx.block.update({ where: { id: t.blockId }, data });
      }

      await rtx.auditLog.createMany({
        data: [
          // Obvyklý dvoupolní skupinový cíl (přesun): jeden řádek, složený tvar
          // `startTime/endTime` — `COMPOSITE_FIELDS` ho zná (`auditCoverage.ts`).
          // Jednopolní cíl (M7, čistý resize jen konce) jede stejnou per-pole cestou
          // jako `--also-revision` níž — `field` se pak bere doslova jako jméno sloupce.
          ...groupTargets.flatMap((t) =>
            t.fields.length === 2 && t.fields.includes("startTime") && t.fields.includes("endTime")
              ? [{
                  blockId: t.blockId,
                  orderNumber: t.orderNumber,
                  userId: 0,
                  username: "system:revert-revision-group",
                  action: "INCIDENT_REVERT",
                  field: "startTime/endTime",
                  oldValue: span(t.expect.startTime as Date, t.expect.endTime as Date),
                  newValue: span(t.to.startTime as Date, t.to.endTime as Date),
                }]
              : t.fields.map((field) => incidentRevertFieldRow(t, field)),
          ),
          // Jeden řádek na pole, ne složené `field: "endTime/printMinutes"` —
          // `COMPOSITE_FIELDS` takový tvar nezná a pokrytí by ho vzalo za jméno
          // jednoho (neexistujícího) sloupce.
          ...alsoTargets.flatMap((t) => t.fields.map((field) => incidentRevertFieldRow(t, field))),
        ],
      });

      // Finální pojistka per stroj — parita s ostatními zápisovými cestami. Stroj se bere
      // z ČERSTVÉHO čtení (freshById), ne ze stálé mapy zvenku transakce (M1) — chybějící
      // blok v tomhle bodě je nedosažitelná větev, která má PADAT, ne mlčky pokračovat.
      const byMachine = new Map<string, number[]>();
      for (const t of [...groupTargets, ...alsoTargets]) {
        const machine = freshById.get(t.blockId)?.machine;
        if (!machine) throw new Error(`Blok ${t.blockId} zmizel mezi kontrolou a zápisem.`);
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
    // M2: celý objekt chyby, ne jen message — u Prisma chyb (P2025 apod.) jinak zmizí
    // `code`/`meta`, přesně ve chvíli, kdy se nejvíc hodí.
    console.error("\n❌ Selhalo:");
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
