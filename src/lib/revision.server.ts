import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { logger } from "@/lib/logger";
import { normalizeBlockRow } from "@/lib/revision/rowNormalize";
import { computeRevisionDiff } from "@/lib/revision/diff";
import {
  BLOCK_RELATION_FIELDS,
  BLOCK_INBOUND_RELATION_FIELDS,
  NESTED_WRITE_OPERATIONS,
} from "@/lib/revision/blockColumns";

/**
 * Která mutační CESTA běžela. NENÍ to `AuditLog.action` — ten popisuje, co se
 * stalo s ŘÁDKEM. Vokabuláře obou tabulek se proto nesmí míchat v jednom dotazu.
 *
 * Hodnoty pro opačné směry jsou tu záměrně, i když je routa v páru: bez nich
 * `WHERE action='PRINT_COMPLETE'` vrátil v `AuditLog` jen potvrzení tisku, ale
 * v `BlockRevision` potvrzení I vrácení — a panel historie postavený nad tím by
 * tvrdil „tiskař potvrdil tisk" tam, kde ho vrátil (recenze 8. 8. 2026, K5).
 * Sloupec je `VARCHAR(32)`, ne databázový enum, takže rozšíření slovníku je
 * čistě typová změna — žádná migrace. Nejdelší hodnota má 20 znaků.
 */
export type RevisionAction =
  | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
  | "SPLIT" | "REFLOW"
  | "UNDO" | "REDO"
  | "PRINT_COMPLETE" | "PRINT_UNDO"
  | "EXPEDITION_PUBLISH" | "EXPEDITION_UNPUBLISH" | "EXPEDITION_REORDER";

type Row = Record<string, unknown>;
type Kind = "CREATE" | "UPDATE" | "DELETE";

/** `BlockRevision.machine` je NOT NULL — marker řádek bez známého bloku potřebuje výplň. */
const UNKNOWN_MACHINE = "?";

/** `BlockRevision.label` je VARCHAR(191); delší popisek by shodil CELOU mutaci. */
const LABEL_MAX = 191;

/**
 * Čtecí metody delegáta `block`, které Proxy pouští beze změny.
 *
 * Seznam je ALLOW-LIST, ne deny-list, a to záměrně: „co není výslovně povoleno,
 * je zakázáno". Deny-list zápisových metod zastará ve chvíli, kdy Prisma přidá
 * novou zápisovou metodu — ta by tiše propadla na syrový delegát a revize by se
 * nezapsala. Přesně tohle se stalo s `upsert`: propadl větví `default:`, blok se
 * změnil a historie o tom nevěděla (ověřeno sondou proti dev DB 7. 8. 2026).
 * Nová verze Prismy s novou zápisovou metodou má proto spadnout, ne obejít revize.
 */
const READ_ONLY_METHODS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
  "findMany", "count", "aggregate", "groupBy", "fields",
]);

/**
 * Modely, které Proxy propouští beze změny — nemají relaci do Block, takže
 * přes ně vnořeným zápisem blok změnit nejde. Sestaveno podle skutečného
 * použití v repu; přidání dalšího je vědomý krok, ne kosmetika.
 */
const PASSTHROUGH_MODELS = new Set([
  "notification", "companyDay", "machineWeekShifts", "user",
  "shiftAssignment", "expeditionManualItem", "blockRevision",
  // JobPreset je číselník bez JAKÉKOLIV relace na Block (`Block.jobPresetId` je
  // holý Int, ne cizí klíč) — vnořeným zápisem přes něj blok změnit nejde.
  // Doplněno v Tasku 6: PUT bloku ověřuje preset uvnitř transakce a bez tohohle
  // řádku by musel sáhnout na globální `prisma`, tedy mimo revizi i mimo rollback.
  "jobPreset",
]);

/**
 * Modely S relací do Block (`SplitGroup.blocks`, `Reservation.blocks`,
 * `BlockNote.block`). Propouštějí se, ale s kontrolou vnořeného zápisu —
 * `rtx.splitGroup.update({ data: { blocks: { updateMany: … } } })` jinak
 * změní bloky úplně mimo revizi (ověřeno sondou).
 */
const BLOCK_LINKED_MODELS = new Set(["reservation", "splitGroup", "blockNote"]);

/** Čtecí raw dotaz. `$executeRaw*` a `$queryRawUnsafe` záměrně NE — zapisují mimo revizi. */
const PASSTHROUGH_TX_PROPS = new Set(["$queryRaw"]);

/** Auditní delegát: krom obalených `create`/`createMany` jen čtení. */
const AUDIT_READ_METHODS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
  "findMany", "count", "aggregate", "groupBy", "fields",
]);

const NESTED_WRITE_OPS = new Set<string>(NESTED_WRITE_OPERATIONS);

/**
 * Odmítne vnořený relační zápis. Obal zjišťuje dotčené řádky výhradně
 * z `args.where`, takže cokoliv schovaného v `args.data` by změnilo bloky
 * bez revize — a to i skrz sanktifikovaný `rtx.block`, tedy cestou, která
 * vypadá jako správné použití pomocníka.
 */
function assertNoNestedRelationWrite(
  op: string,
  data: unknown,
  relationFields: readonly string[],
): void {
  if (!data || typeof data !== "object") return;
  for (const field of relationFields) {
    const value = (data as Record<string, unknown>)[field];
    if (!value || typeof value !== "object") continue;
    const ops = Object.keys(value as Record<string, unknown>).filter((k) => NESTED_WRITE_OPS.has(k));
    if (ops.length === 0) continue;
    throw new Error(
      `${op}: vnořený zápis přes relaci "${field}" (${ops.join(", ")}) není uvnitř withRevision ` +
      "podporovaný, revize by se nezapsala — obal zjišťuje dotčené řádky jen z `where`, " +
      "nikdy z `data`. Zapiš dotčené bloky adresně přes rtx.block.*.",
    );
  }
}

/**
 * Neúplné zachycení: mezi snapshotem a zápisem se objevil fantom.
 * Ve vývoji a testech se hází, na produkci se degraduje na `partial: true` —
 * spadnout uživateli uprostřed plánování je horší než neúplná revize.
 */
function onCountMismatch(
  groupId: string,
  capturedIds: number[],
  affected: number,
  cap: Capture,
  op: string,
): void {
  cap.partial = true;
  // Zachycená id v hlášce jsou nutná pro forenziku: bez nich nejde chybějící
  // řádek dohledat proti AuditLog.
  const msg =
    `[revize] ${op} zasáhl ${affected} řádků, ale zachytilo se ${capturedIds.length} ` +
    `(groupId ${groupId}, zachycená id: ${capturedIds.join(",") || "žádná"})`;
  if (process.env.NODE_ENV !== "production") throw new Error(msg);
  logger.error(msg);
}

/** Sběrač stavu jedné transakce. */
class Capture {
  readonly before = new Map<number, Row>();
  readonly kinds = new Map<number, Kind>();
  /**
   * Existoval řádek v DB PŘED transakcí? Plní se při PRVNÍM doteku id.
   * Bez toho se `kind` odvozuje jen z pořadí volání a lže: `delete`+`create`
   * téhož id (vzor remove+restore z undoApply) by dalo `kind=CREATE` a zahodilo
   * zachycený obraz „před".
   */
  readonly existedBefore = new Map<number, boolean>();
  partial = false;

  noteExistence(id: number, existed: boolean) {
    if (!this.existedBefore.has(id)) this.existedBefore.set(id, existed);
  }

  markKind(id: number, kind: Kind) {
    const current = this.kinds.get(id);
    // CREATE přebíjí UPDATE: řádek, který v téže transakci vznikl a pak se
    // změnil, je pořád CREATE.
    if (current === "CREATE" && kind === "UPDATE") return;
    // Řádek, který v DB existoval před transakcí, nemůže být CREATE ani po
    // dvojici delete+create — pro historii je to UPDATE, jinak by se zahodil
    // zachycený stav „před" a B2 by z něj sestavilo mazání existujícího bloku.
    if (kind === "CREATE" && this.existedBefore.get(id) === true) {
      this.kinds.set(id, "UPDATE");
      return;
    }
    this.kinds.set(id, kind);
  }
}

/**
 * Zápis musí vrátit `id`, jinak revizi není k čemu připnout. Se `select`em
 * bez `id` (nebo s `omit`) by `created.id` bylo `undefined`, klíč by propadl
 * až na `continue` v epilogu a blok by vznikl BEZ revize, bez chyby a bez logu.
 */
function assertReturnedId(op: string, res: unknown): asserts res is { id: number } {
  if (typeof (res as { id?: unknown } | null)?.id !== "number") {
    throw new Error(
      `${op} uvnitř withRevision musí vracet id — odeber select/omit, nebo do něj doplň id: true. ` +
      "Bez id nelze revizi zapsat a změna by zmizela z historie.",
    );
  }
}

/** Zamykající current-read dotčených řádků. Neopakuje už zachycené. */
async function captureBefore(tx: PrismaTransactionClient, cap: Capture, ids: number[]) {
  const missing = ids.filter((id) => !cap.before.has(id));
  if (missing.length === 0) return;
  const rows = await tx.$queryRaw<Row[]>`
    SELECT * FROM Block WHERE id IN (${Prisma.join(missing)}) FOR UPDATE
  `;
  const found = new Set<number>();
  for (const raw of rows) {
    const row = normalizeBlockRow(raw);
    const id = Number(row.id);
    cap.before.set(id, row);
    found.add(id);
    cap.noteExistence(id, true);
  }
  for (const id of missing) if (!found.has(id)) cap.noteExistence(id, false);
}

/**
 * Která z `ids` v DB SKUTEČNĚ ještě jsou. Musí to být ZAMYKAJÍCÍ čtení:
 * obyčejný `tx.block.findMany` by pod MySQL REPEATABLE READ vrátil i řádek,
 * který mezitím někdo jiný smazal a commitnul (transakce čte ze svého read
 * view) — a přesně ten rozdíl se tímhle dotazem rozhoduje. Nové zámky to
 * nepřidává: nad nalezenými řádky je už drží `captureBefore`.
 */
async function selectExistingIds(tx: PrismaTransactionClient, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<{ id: number | bigint }[]>`
    SELECT id FROM Block WHERE id IN (${Prisma.join(ids)}) FOR UPDATE
  `;
  return new Set(rows.map((r) => Number(r.id)));
}

/**
 * Rozhodne, jestli je rozdíl mezi snapshotem (`resolveIds`) a current readem
 * (`updateMany`/`deleteMany`) vada, nebo běžný souběh. Liší se ze DVOU důvodů
 * a jen jeden z nich je fantom:
 *
 * (a) LEGITIMNÍ SOUBĚŽNÉ SMAZÁNÍ — někdo jiný řádek mezitím smazal a commitnul.
 *     Snapshot ho ještě vidí, zápis už ne, a zachycení „před" ho taky nenašlo,
 *     takže revizi stejně není z čeho postavit. Hlásit tohle jako fantom shodí
 *     ZDRAVOU editaci: ve vývoji výjimkou (celá transakce rollback, uživatel
 *     dostane 500 a jeho změna se neuloží), na produkci příznakem `partial` pro
 *     CELOU skupinu — a partial podle schématu NIKDY nesmí vyrobit undo operaci,
 *     takže by se krok tiše stal nevratitelným. Doloženo dvěma servery nad
 *     dvěma klony DB: PUT sdíleného pole na split hlavu × souběžné smazání
 *     sourozence dalo před opravou 500, po ní 200 (recenze 8. 8. 2026, K2).
 *
 * (b) SKUTEČNÝ FANTOM — zápis trefil řádek, který zachycení nevidělo. Typicky
 *     když do `where` mezitím řádek PŘIBYL (cizí INSERT): ten se změnil BEZ
 *     revize, a to je jediný případ, který se hlásit musí.
 */
async function reconcileCountMismatch(
  tx: PrismaTransactionClient,
  cap: Capture,
  groupId: string,
  ids: number[],
  affected: number,
  op: string,
): Promise<void> {
  const existing = await selectExistingIds(tx, ids);
  // Odečítají se JEN řádky, které v DB nejsou A zachycení je nenašlo — to je
  // podpis souběžného smazání. Řádek se zachyceným stavem „před", který zmizel,
  // sem nepatří: nad ním držíme `FOR UPDATE`, takže ho nikdo cizí smazat nemohl,
  // a jeho nezasažení znamená, že vypadl z `where` — což hlásit chceme.
  const vanished = new Set(ids.filter((id) => !existing.has(id) && !cap.before.has(id)));
  for (const id of vanished) cap.kinds.delete(id);
  if (affected === ids.length - vanished.size) return;
  onCountMismatch(groupId, ids.filter((id) => !vanished.has(id)), affected, cap, op);
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
          return async (args: { where: unknown; data?: unknown }) => {
            assertNoNestedRelationWrite("block.update", args.data, BLOCK_RELATION_FIELDS);
            const ids = await resolveIds(tx, args.where, false);
            await captureBefore(tx, cap, ids);
            const res = await (target as any).update(args);
            // Značka až PO úspěšném zápisu: spolknutá chyba by jinak vyrobila
            // revizi o změně, ke které nedošlo.
            ids.forEach((id) => cap.markKind(id, "UPDATE"));
            return res;
          };
        case "updateMany":
          return async (args: { where: unknown; data?: unknown }) => {
            assertNoNestedRelationWrite("block.updateMany", args.data, BLOCK_RELATION_FIELDS);
            const ids = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, ids);
            const res = await (target as any).updateMany(args);
            ids.forEach((id) => cap.markKind(id, "UPDATE"));
            if (res.count !== ids.length) await reconcileCountMismatch(tx, cap, groupId, ids, res.count, "updateMany");
            return res;
          };
        case "delete":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, false);
            await captureBefore(tx, cap, ids);
            const res = await (target as any).delete(args);
            ids.forEach((id) => cap.markKind(id, "DELETE"));
            return res;
          };
        case "deleteMany":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, ids);
            const res = await (target as any).deleteMany(args);
            ids.forEach((id) => cap.markKind(id, "DELETE"));
            if (res.count !== ids.length) await reconcileCountMismatch(tx, cap, groupId, ids, res.count, "deleteMany");
            return res;
          };
        case "create":
          return async (args: { data?: unknown }) => {
            assertNoNestedRelationWrite("block.create", args?.data, BLOCK_RELATION_FIELDS);
            const created = await (target as any).create(args);
            assertReturnedId("block.create", created);
            cap.noteExistence(created.id, false);
            cap.markKind(created.id, "CREATE");
            return created;
          };
        case "upsert":
          return async (args: { where: unknown; create?: unknown; update?: unknown }) => {
            assertNoNestedRelationWrite("block.upsert", args.create, BLOCK_RELATION_FIELDS);
            assertNoNestedRelationWrite("block.upsert", args.update, BLOCK_RELATION_FIELDS);
            // Existenci řádku je nutné zjistit PŘED zápisem — potom už nejde poznat,
            // jestli upsert aktualizoval, nebo založil. `true` vynutí dohledání
            // přes findMany (ne zkratku na `where.id`), protože u `where: { id }`
            // zkratka vrací id i pro řádek, který vůbec neexistuje.
            const existing = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, existing);
            const res = await (target as any).upsert(args);
            assertReturnedId("block.upsert", res);
            if (existing.length > 0) {
              existing.forEach((id) => cap.markKind(id, "UPDATE"));
            } else {
              cap.noteExistence(res.id, false);
              cap.markKind(res.id, "CREATE");
            }
            return res;
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
          // Symboly a `then` musí projít beze změny, jinak se rozbije interní
          // chování Prismy a thenable-check při `await` (ověřeno sondou: runtime
          // na `then` delegáta skutečně sahá).
          if (typeof prop === "symbol" || prop === "then") return Reflect.get(target, prop, receiver);
          if (READ_ONLY_METHODS.has(prop)) return Reflect.get(target, prop, receiver);
          throw new Error(
            `block.${String(prop)} není uvnitř withRevision podporované, revize by se nezapsala. ` +
            "Delegát pouští jen výslovně povolené čtecí metody; zápisové cesty musí mít " +
            "v makeClient vlastní obsluhu, která zachytí stav před změnou.",
          );
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
        return (args: { data: Record<string, unknown> | Record<string, unknown>[] }) => {
          // `createMany({ data: jedinýObjekt })` je typově legální; bez tohohle
          // srovnání by `.map` spadl na TypeError z útrob pomocníka.
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          return (target as any).createMany({ ...args, data: rows.map((row) => ({ ...row, groupId })) });
        };
      }
      if (typeof prop === "symbol" || prop === "then") return Reflect.get(target, prop, receiver);
      if (AUDIT_READ_METHODS.has(prop)) return Reflect.get(target, prop, receiver);
      // Fail-open by tu znamenal auditní řádek bez groupId (např. přes `upsert`),
      // a tím rozpad korelace revize ↔ audit v panelu historie.
      throw new Error(
        `auditLog.${String(prop)} není uvnitř withRevision podporované — auditní řádek by přišel ` +
        "bez groupId a nespároval by se s revizí. Použij create nebo createMany.",
      );
    },
  });

  /** Delegát cizího modelu s relací do Block: propuštěný, ale bez vnořeného zápisu do bloků. */
  const makeLinkedDelegate = (model: string, delegate: object) =>
    new Proxy(delegate, {
      get(target, prop, receiver) {
        if (typeof prop === "symbol" || prop === "then") return Reflect.get(target, prop, receiver);
        if (prop === "create" || prop === "update" || prop === "updateMany" || prop === "upsert") {
          return (args: { data?: unknown; create?: unknown; update?: unknown }) => {
            assertNoNestedRelationWrite(`${model}.${prop}`, args?.data, BLOCK_INBOUND_RELATION_FIELDS);
            assertNoNestedRelationWrite(`${model}.${prop}`, args?.create, BLOCK_INBOUND_RELATION_FIELDS);
            assertNoNestedRelationWrite(`${model}.${prop}`, args?.update, BLOCK_INBOUND_RELATION_FIELDS);
            return (target as any)[prop](args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "block") return blockDelegate;
      if (prop === "auditLog") return auditDelegate;
      if (typeof prop === "symbol" || prop === "then") return Reflect.get(target, prop, receiver);
      if (BLOCK_LINKED_MODELS.has(prop)) {
        return makeLinkedDelegate(prop, Reflect.get(target, prop, receiver));
      }
      if (PASSTHROUGH_TX_PROPS.has(prop)) {
        // SVÁZAT se syrovým `tx`, ne jen propustit. `$queryRaw` je metoda KLIENTA
        // (ne delegáta modelu) a uvnitř sahá na `this._createPrismaPromise`.
        // Bez `bind` se `this` nastaví na tuhle Proxy, interní vlastnost spadne
        // do allow-listu a celá mutace umře na „rtx._createPrismaPromise není
        // povolené". Objevilo se to až při zapojení PUT (Task 6): `$queryRaw`
        // volá `assertNoOverlapForBlocks`, tedy finální pojistka na KAŽDÉ
        // zápisové cestě — jednotkové testy jádra ho volaly nad syrovým `tx`,
        // takže na tohle nedosáhly.
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
      if (PASSTHROUGH_MODELS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      // Allow-list i na tomhle patře — jinak tudy projde `$executeRaw`,
      // `$queryRawUnsafe` i PascalCase alias `rtx.Block` (Prisma registruje
      // každý model dvakrát), a všechny tři zapíšou do Block bez revize.
      throw new Error(
        `rtx.${String(prop)} není uvnitř withRevision povolené. Do Block se píše výhradně přes ` +
        "rtx.block.*; raw zápis a neuvedené modely jsou zakázané, protože by revizi obešly. " +
        "Pokud jde o model bez vazby na Block, doplň ho do PASSTHROUGH_MODELS.",
      );
    },
  }) as PrismaTransactionClient;
}

/**
 * Běžící `withRevision`. Slouží jen k detekci vnoření — vnořené volání by
 * otevřelo DRUHOU transakci, ta by se na týchž řádcích zakousla o zámky
 * vnější (naměřeno 50 s do `innodb_lock_wait_timeout` a P2028), a nad
 * různými řádky by její zápis i revize PŘEŽILY rollback té vnější.
 */
const revisionScope = new AsyncLocalStorage<{ groupId: string }>();

/**
 * Obalí celou mutaci: otevře transakci, podstrčí tělu klient s nahrazenými
 * delegáty `block` a `auditLog`, a na konci zapíše revize.
 *
 * **Co pomocník zaručuje a co ne** (formulováno po multi-agent recenzi 8. 8. 2026;
 * dřívější znění „jinudy zapsat nejde" bylo prokazatelně nepravdivé a od téhle
 * věty se odvozuje, jak pečlivě se budou revidovat napojené routy):
 *
 * - STRUKTURÁLNĚ uzavřené: tělo nedostane syrový `tx`; delegát `block` pouští
 *   jen povolené čtecí metody a obalené zápisy; vnořený relační zápis v `data`
 *   je odmítnutý; vnější Proxy je allow-list, takže `$executeRaw`, PascalCase
 *   aliasy ani neuvedené modely neprojdou; vnoření `withRevision` hází.
 * - NEUZAVŘENÉ, hlídá jen code review: modulový singleton `prisma` je
 *   v uzávěru KAŽDÉHO těla (routy si ho importují nahoře). Zápis přes
 *   `prisma.*` uvnitř těla revizi obejde a navíc PŘEŽIJE rollback, protože
 *   běží mimo transakci. Uvnitř `withRevision` se proto `prisma.*` nesmí
 *   použít ani pro čtení — do Block výhradně přes `rtx.block.*`.
 *   Pozor i na nepřímé nosiče: helper, který si klienta bere z importu
 *   místo z parametru (dnes `src/lib/scheduleSlotFinder.ts`), tohle pravidlo
 *   obejde, aniž by to v routě bylo vidět.
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
  if (revisionScope.getStore()) {
    throw new Error(
      "withRevision nelze vnořit — obal ROUTU, ne sdílený helper. Vnořená transakce se " +
      "zakousne o zámky té vnější, a nad různými řádky by její zápis přežil její rollback.",
    );
  }

  const groupId = randomBytes(16).toString("base64url");

  const result = await revisionScope.run({ groupId }, () => prisma.$transaction(async (tx) => {
    const cap = new Capture();
    const rtx = makeClient(tx, cap, groupId);
    const bodyResult = await body(rtx);

    const ids = [...cap.kinds.keys()];
    const rows: Prisma.BlockRevisionCreateManyInput[] = [];

    if (ids.length > 0) {
      const afterRows = new Map<number, Row>();
      // FOR UPDATE i tady: nezamykající čtení vrátí u řádku, který transakce
      // sama nezapsala, starou verzi z read view — a revize pak tvrdí opak
      // toho, co se stalo (rozdíl obráceným směrem, připsaný uživateli, který
      // na řádek vůbec nesáhl). Falešný forenzní záznam je horší než chybějící.
      // Nové zámky to nepřidává: tyhle řádky už drží captureBefore.
      const raw = await tx.$queryRaw<Row[]>`
        SELECT * FROM Block WHERE id IN (${Prisma.join(ids)}) FOR UPDATE
      `;
      for (const r of raw) {
        const row = normalizeBlockRow(r);
        afterRows.set(Number(row.id), row);
      }

      for (const id of ids) {
        const before = cap.before.get(id) ?? null;
        const after = afterRows.get(id) ?? null;

        // `markKind` u `deleteMany` označí DELETE VŠECHNA id z `where`, ne jen
        // ta, která příkaz skutečně zasáhl — a rozdíl mezi tím pozná jedině
        // tenhle epilog, protože je jediný, kdo čte aktuální stav. Řádek
        // označený DELETE, který se v aktuálním čtení POŘÁD NAJDE, smazaný
        // nebyl: mezi snímkem a zápisem vypadl z podmínky `where` (cizí commit
        // mu změnil sloupec, na který se `where` ptá). Živý blok proto nesmí
        // dostat kind=DELETE — etapa B2 by z takového řádku sestavila příkaz
        // k jeho smazání a záchranná brzda by se změnila v nástroj ztráty dat.
        let kind = cap.kinds.get(id)!;
        if (kind === "DELETE" && after) {
          // Běžná cesta je UPDATE s normálním rozdílem (prázdný rozdíl se zahodí sám).
          //
          // Větev `existedBefore === false` (tedy CREATE) je ČISTĚ OBRANNÁ a dnes
          // NEDOSAŽITELNÁ — nepiš na ni test, měřil by fikci. Musel by nastat blok,
          // který vznikl uvnitř TÉHLE transakce a pak vypadl z `where` mezi
          // `resolveIds` a samotným `deleteMany`. Vypadnout může jedině tak, že mu
          // někdo změní sloupec, na který se `where` ptá — jenže mezi těmi dvěma
          // příkazy neběží nic jiného z téhle transakce a cizí transakce ten řádek
          // nevidí ani změnit nemůže, protože je necommitnutý. Ověřeno sondou proti
          // dev DB (8. 8. 2026): cizí spojení blok `count`em NEVIDÍ a `updateMany`
          // na něm umře na lock wait timeout. Totéž chrání i exotičtější variantu
          // (cizí smazání a vložení řádku se stejným id): `FOR UPDATE` v
          // `captureBefore` drží nad neexistujícím id gap lock, který cizí INSERT
          // do té mezery zablokuje.
          //
          // Kdyby ta situace přesto někdy nastala, CREATE je správná odpověď:
          // převod na UPDATE by řádek poslal rovnou do následující větve
          // „vznikl a byl smazán → nezapisovat" a revize o VZNIKU bloku by zmizela.
          kind = cap.existedBefore.get(id) === false ? "CREATE" : "UPDATE";
        }

        // Blok, který v téže transakci vznikl A byl smazán, nezapisujeme vůbec:
        // v databázi po něm nic nezůstalo, není co zaznamenávat. Není to
        // opomenutí — zvláštní značka („TRANSIENT") by se do sloupce `kind`
        // typu VARCHAR(8) ani nevešla.
        if (kind === "DELETE" && cap.existedBefore.get(id) === false) continue;
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
          label: meta.label.slice(0, LABEL_MAX),
          userId: meta.user.id,
          username: meta.user.username,
          before: beforeJson,
          after: afterJson,
          rowVersion: (after?.updatedAt as Date | undefined) ?? null,
          partial: cap.partial,
        });
      }
    }

    // Fantom, který zápis trefil a zachycení minulo, by jinak nezanechal
    // v BlockRevision vůbec nic — jen řádek v logu. Marker (blockId 0) je
    // forenzní stopa, že v téhle groupId bylo zachycení neúplné. Je ZÁMĚRNĚ
    // mimo `ids.length > 0`: když capture mine všechny řádky, není co projít.
    if (cap.partial && rows.length === 0) {
      rows.push({
        groupId,
        blockId: 0,
        machine: UNKNOWN_MACHINE,
        orderNumber: null,
        action: meta.action,
        kind: "UPDATE",
        label: meta.label.slice(0, LABEL_MAX),
        userId: meta.user.id,
        username: meta.user.username,
        before: Prisma.DbNull,
        after: Prisma.DbNull,
        rowVersion: null,
        partial: true,
      });
    }

    if (rows.length > 0) await tx.blockRevision.createMany({ data: rows });

    return bodyResult;
    // Rozšíření, ne náhrada: `{ timeout: 30000 }` od volajícího by jinak
    // srazilo maxWait z 5 s na výchozí 2 s.
  }, { timeout: 15000, maxWait: 5000, ...meta.txOptions }));

  return { result, groupId };
}
