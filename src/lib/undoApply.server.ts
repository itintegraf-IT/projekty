import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { isRestorableField } from "@/lib/undo/restoreFields";
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { logger } from "@/lib/logger";
import { SLOT_MS } from "@/lib/timeSlots";
import { truncateUtf8 } from "@/lib/textTruncate";
import { loadMachineCalendarRange } from "@/lib/printTime.server";
import { UNDO_MIXED_FIELD_PREFIX } from "@/lib/auditFormatters";

export type UndoOp =
  | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };

export type UndoDirection = "undo" | "redo";

/** Sloupce bez defaultu a bez `?` — bez nich Prisma create neprojde. */
export const REQUIRED_ON_CREATE = ["orderNumber", "machine", "startTime", "endTime"] as const;

/**
 * Celá poziční pětice, kterou `posOp`/`buildMoveOrResizeCommand`
 * (`src/lib/undo/commands.ts`) i `mergePositionIntoTargets`
 * (`src/lib/undo/splitSiblingFields.ts`) VŽDY zapisují pohromadě, nikdy
 * jednotlivě. Audit řádek níž musí z „business polí navíc" vyřadit VŠECH
 * pět, ne jen trojici `startTime`/`endTime`/`machine`, kterou testuje
 * `touchesPosition` — jinak by KAŽDÁ čistě poziční obnova (op.fields vždy
 * nese i `printMinutes`/`scheduleBypassed`) vypadala jako smíšená, protože
 * by ve „zbylých" klíčích našla právě tahle dvě doprovodná pole (fix
 * round 1, review nález o ztrátě seznamu polí u smíšeného řádku).
 */
const POSITION_FIELD_KEYS = new Set(["startTime", "endTime", "machine", "printMinutes", "scheduleBypassed"]);

/**
 * Bezpečná horní mez pro `field` sloupec (`VARCHAR(191)`) se sestaveným
 * seznamem business polí u smíšeného řádku (fix round 1). Content je vždy
 * čistě ASCII (technické názvy sloupců Blocku, žádná diakritika), takže
 * bajty i znaky vycházejí nastejno — 180 nechává komfortní rezervu pod 191
 * a `truncateUtf8` (bajtový ořez) tak nikdy nepřeteče char limit sloupce.
 */
const AUDIT_MIXED_FIELD_MAX_BYTES = 180;

function bad(message: string): never {
  throw new AppError("VALIDATION_ERROR", message);
}

/**
 * Jediná brána mezi tělem requestu a transakcí. Endpoint NESMÍ být univerzální
 * zápis do Block — všechno, co projde sem, se zapíše doslova bez další validace.
 */
export function sanitizeUndoOps(raw: unknown): UndoOp[] {
  if (!Array.isArray(raw) || raw.length === 0) bad("Seznam operací je prázdný nebo není pole.");
  if (raw.length > 200) bad("Seznam operací je příliš dlouhý (max 200).");

  const seen = new Set<number>();
  const ops: UndoOp[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) bad("Operace není objekt.");
    const o = item as Record<string, unknown>;

    if (!Number.isInteger(o.id) || (o.id as number) <= 0 || (o.id as number) > 2147483647) bad(`Neplatné id bloku: ${String(o.id)}`);
    const id = o.id as number;
    if (seen.has(id)) bad(`Blok ${id} je v dávce vícekrát — undo musí mít na blok jedinou operaci.`);
    seen.add(id);

    let expectedUpdatedAt: string | undefined;
    if (o.expectedUpdatedAt !== undefined) {
      if (typeof o.expectedUpdatedAt !== "string" || Number.isNaN(new Date(o.expectedUpdatedAt).getTime())) {
        bad(`Neplatné expectedUpdatedAt u bloku ${id}.`);
      }
      expectedUpdatedAt = o.expectedUpdatedAt;
    }

    if (o.kind === "remove") {
      ops.push({ kind: "remove", id, expectedUpdatedAt });
      continue;
    }
    if (o.kind !== "upsert") bad(`Neznámá operace: ${String(o.kind)}`);

    if (typeof o.fields !== "object" || o.fields === null || Array.isArray(o.fields)) {
      bad(`Chybí fields u bloku ${id}.`);
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(o.fields as Record<string, unknown>)) {
      if (!isRestorableField(key)) bad(`Pole "${key}" undo obnovovat nesmí (blok ${id}).`);
      // Hodnota musí být primitivum (string, number, boolean, null), ne objekt ani pole.
      // Prisma by atomické operace jako { increment: 999 } interpretoval špatně.
      if (typeof value === "object" && value !== null) {
        bad(`Pole "${key}" má neplatný formát (pole nebo objekt), povolena jsou jen primitiva: blok ${id}.`);
      }
      fields[key] = value;
    }
    ops.push({ kind: "upsert", id, expectedUpdatedAt, fields });
  }
  return ops;
}

export type UndoActor = { id: number; username: string };
/**
 * `removed` nese i `machine` (ne jen `removedIds: number[]`) — SSE gate pro roli
 * TISKAR (`shouldSendEvent` v `src/app/api/events/route.ts`) filtruje `block:deleted`
 * podle `payload.machine === assignedMachine` a je fail-closed: bez stroje by tiskař
 * o smazání vlastního bloku přes undo/redo nikdy nezjistil (ověřeno grepem, ne odhadem).
 */
export type UndoApplyResult = { updatedIds: number[]; createdIds: number[]; removed: Array<{ id: number; machine: string }> };

const span = (start: unknown, end: unknown) =>
  `${new Date(start as string).toISOString()}–${new Date(end as string).toISOString()}`;

/**
 * Provede celou undo dávku. Volá se UVNITŘ `prisma.$transaction` — buď projde
 * celá, nebo se rollbackne a nezmění se nic.
 *
 * ZÁMĚRNĚ NEVOLÁ `validateAndComputeEnd`. Undo vrací stav, který v DB
 * prokazatelně existoval; měřit ho dnešními pravidly je kategorická chyba
 * (přesně to dnes rozbíjí návrat bloků mimo 30min mřížku). Endpoint nevolá
 * ani `expandPrintTime`, takže mřížkovou bránu nepotřebuje — ta je jen
 * předsazená pojistka před tvrdým throwem uvnitř expanze.
 *
 * Co běží VŽDY: optimistic lock (na zamykajícím čtení, viz níže), zákaz smazat
 * vytištěný blok, kontrola platného a správně seřazeného intervalu a finální
 * `assertNoOverlapForBlocks`. Rané overlap kontroly se nespouštějí vůbec —
 * mezistavy uvnitř transakce nikdo nevidí, takže na pořadí operací nezáleží.
 *
 * NEbere `label` (odstraněno v Tasku 4 — bylo to nepoužité, viz `progress.md`
 * review Tasku 3, M2). Popisek kroku zůstává jen na vstupu HTTP endpointu a
 * loguje se AŽ PO commitu přes `logger.info` — sem by nesměl vůbec, funkce
 * běží uvnitř transakce a log napsaný odtud by přežil i rollback.
 */
export async function applyUndoOps(
  tx: PrismaTransactionClient,
  ops: UndoOp[],
  actor: UndoActor,
  direction: UndoDirection,
): Promise<UndoApplyResult> {
  if (ops.length === 0) return { updatedIds: [], createdIds: [], removed: [] };
  const ids = ops.map((o) => o.id);

  // Zamykající čtení MUSÍ být první dotaz v transakci. Obyčejný `findMany` je pod
  // MySQL REPEATABLE READ jen consistent read (nebere zámky) — mezi ním a
  // následným update/delete by mohl vklouznout souběžný commit odjinud a
  // optimistic lock i printCompletedAt guard níž by ho vůbec neviděly (TOCTOU
  // mezera, kterou měl přesun do transakce zavřít, ale beze zámku nezavírá).
  // `SELECT ... FOR UPDATE` bere per-row X-zámky — stejný vzor jako
  // assertNoOverlapForBlocks v overlapCheck.ts. Vybírá záměrně jen `id`: zamyká
  // celý řádek bez ohledu na to, které sloupce jsou v SELECT listu, a skutečná
  // data načte hned pod tím normální typovaný `findMany` — raw `SELECT *` by
  // MySQL BOOLEAN sloupce (locked, dataOk, ...) vrátil jako 0/1 místo true/false
  // (ověřeno přímo proti dev DB), což by rozbilo JSON snapshot v kroku 4 níž.
  // Konzistentní read `findMany` hned po zamykajícím čtení uvidí přesně to, co
  // jsme právě zamkli (žádná jiná transakce se mezitím k těm řádkům nedostane).
  await tx.$queryRaw`SELECT id FROM Block WHERE id IN (${Prisma.join(ids)}) FOR UPDATE`;
  const existing = await tx.block.findMany({ where: { id: { in: ids } } });
  const byId = new Map(existing.map((b) => [b.id, b]));

  // ── 1. Optimistic lock — VŠECHNY najednou, PŘED prvním zápisem ───────────
  const stale: number[] = [];
  for (const op of ops) {
    if (!op.expectedUpdatedAt) continue;
    const row = byId.get(op.id);
    if (!row) continue; // chybějící řádek řeší větev create / idempotentní remove
    if (row.updatedAt.getTime() !== new Date(op.expectedUpdatedAt).getTime()) stale.push(op.id);
  }
  if (stale.length > 0) {
    throw new AppError("CONFLICT", `Bloky byly mezitím změněny jiným uživatelem: ${stale.join(", ")}`);
  }

  // ── 2. Business pravidlo: vytištěný blok se nemaže ───────────────────────
  // Záměrně NEkontrolujeme `locked` — undo/redo smí zámek přebít (maže typicky
  // blok, který uživatel sám před chvílí vytvořil nebo sám zamkl) — stejný záměr,
  // jaký dřív měl klientský `deleteBlock({ force: true })` efekt (zrušen Taskem 8,
  // nahrazen tímhle atomickým `applyUndo`).
  // Co undo přebít NESMÍ, je potvrzený tisk — tiskař ho mohl mezitím odklepnout
  // nezávisle na tom, co plánovač zrovna vrací zpět — proto zůstává jen tahle
  // jedna kontrola. Není to mezera, je to záměr.
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const row = byId.get(op.id);
    if (row?.printCompletedAt) {
      throw new AppError(
        "CONFLICT",
        `Tisk bloku #${row.orderNumber ?? row.id} mezitím potvrdil tiskař — vrácení zpět by smazalo hotovou práci.`,
      );
    }
  }

  // ── 3. Povinná pole u vytvoření ──────────────────────────────────────────
  for (const op of ops) {
    if (op.kind !== "upsert" || byId.has(op.id)) continue;
    const missing = REQUIRED_ON_CREATE.filter((f) => op.fields[f] === undefined || op.fields[f] === null);
    if (missing.length > 0) {
      throw new AppError("VALIDATION_ERROR", `Obnova bloku ${op.id} nemá povinná pole: ${missing.join(", ")}.`);
    }
  }

  // ── 3b. Neplatný nebo obrácený interval ───────────────────────────────────
  // Jediná zápisová cesta v repu, která by bez týhle kontroly zapsala obrácené
  // nebo nedatovatelné startTime/endTime doslova (parita s POST /api/blocks,
  // src/app/api/blocks/route.ts:79-84). Takový blok projde VŠEMI kontrolami
  // překryvu (obrácené hranice se s ničím neprotnou) a je od té chvíle pro
  // assertNoOverlapForBlocks neviditelný i z druhé strany — na jeho místo by
  // šlo naplánovat cokoliv jiného, aniž by to kdy spadlo na OVERLAP. Musí běžet
  // před prvním zápisem.
  for (const op of ops) {
    if (op.kind !== "upsert") continue;
    const row = byId.get(op.id);
    const hasStart = "startTime" in op.fields;
    const hasEnd = "endTime" in op.fields;
    if (!hasStart && !hasEnd) continue; // operace se času vůbec netýká

    // Chybějící pole na VYTVOŘENÍ už zachytil krok 3. Tady zbývá UPDATE, kde
    // může být zadané jen jedno z dvojice — druhé se bere z DB (aktuální díky
    // zamykajícímu čtení výše). `null`/chybějící by na update přepsal NOT NULL
    // sloupec a spadl by na Prisma constraint chybu místo čisté AppError.
    const startRaw = hasStart ? op.fields.startTime : row?.startTime;
    const endRaw = hasEnd ? op.fields.endTime : row?.endTime;
    if (startRaw == null || endRaw == null) {
      throw new AppError("VALIDATION_ERROR", `Blok ${op.id}: startTime/endTime nesmí být prázdné.`);
    }
    const start = startRaw instanceof Date ? startRaw : new Date(startRaw as string);
    const end = endRaw instanceof Date ? endRaw : new Date(endRaw as string);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new AppError("VALIDATION_ERROR", `Blok ${op.id}: neplatné datum ve startTime/endTime.`);
    }
    if (end.getTime() <= start.getTime()) {
      throw new AppError("VALIDATION_ERROR", `Blok ${op.id}: endTime musí být striktně po startTime.`);
    }
  }

  const result: UndoApplyResult = { updatedIds: [], createdIds: [], removed: [] };
  const auditRows: Record<string, unknown>[] = [];
  // Kontrola PER STROJ (vzor `checkByMachine` z batch/route.ts) — assertNoOverlapForBlocks
  // filtruje `machine = ?` uvnitř sebe, takže smí dostat jen id bloků, které na ten stroj
  // skutečně patří. Plochý seznam všech upsertnutých id předaný do KAŽDÉHO stroje by při
  // dávce přes víc strojů srovnával cizí časová okna a hlásil falešné kolize.
  const idsByMachine = new Map<string, number[]>();
  const addToMachine = (machine: string, id: number) => {
    const arr = idsByMachine.get(machine) ?? [];
    arr.push(id);
    idsByMachine.set(machine, arr);
  };

  // ── 4. Nejdřív mazání (uvolní místo), pak zápisy ─────────────────────────
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const row = byId.get(op.id);
    if (!row) continue; // idempotence: co neexistuje, je už smazané
    await tx.block.delete({ where: { id: op.id } });
    result.removed.push({ id: op.id, machine: row.machine });
    auditRows.push({
      blockId: op.id, orderNumber: row.orderNumber, userId: actor.id, username: actor.username,
      action: direction === "undo" ? "UNDO" : "REDO",
      // Celý blok jako JSON, stejně jako DELETE endpoint ([id]/route.ts) — jediná
      // cesta k ruční rekonstrukci bloku, kterého se undo/redo zbaví bez dalšího
      // undo kroku po ruce (audit DATA-03). Ořez na 60 kB ze stejného důvodu jako
      // tam: sloupec je @db.Text s limitem 65 535 BAJTŮ, řezat se musí po bajtech
      // kvůli diakritice (truncateUtf8, ne `.slice()`).
      field: "delete", oldValue: truncateUtf8(JSON.stringify(row), 60000), newValue: null,
    });
  }

  for (const op of ops) {
    if (op.kind !== "upsert") continue;
    const row = byId.get(op.id);
    const data = toPrismaData(op.fields);

    if (row) {
      const saved = await tx.block.update({ where: { id: op.id }, data });
      result.updatedIds.push(op.id);
      addToMachine(saved.machine, op.id);
      // I2 (go/no-go audit 5. 8. 2026): span start–end jen když se pozice
      // DOOPRAVDY obnovuje. Dřív se psal VŽDY, i pro čistě obchodní editaci
      // (undo materialStatusId apod.) — oldValue/newValue vyšlo stejné (čas se
      // nezměnil) a BlockDetail/InfoPanel to vykreslily jako „vráceno zpět:
      // 2.9. 06:00 → 2.9. 06:00", falešný dojem přesunu, který nikam nevede,
      // a audit přitom vůbec neobsahoval, co se SKUTEČNĚ vrátilo.
      //
      // Fix round 1 (review): mixed zápis (kotva z mergeAnchorPositionIfChanged
      // nese pozici I business pole v jednom opu) binární klasifikace „buď
      // span, nebo seznam polí" tiše zahazovala — pozice vyhrála a seznam polí
      // zmizel, přesně u toho nejběžnějšího případu (kombinovaná editace), který
      // I2 měl řešit. `otherKeys` teď vyřadí CELOU poziční pětici (ne jen trojici
      // z touchesPosition), takže smíšený řádek pozná i business pole vedle
      // pozice; `field` nese oboje najednou (span zůstává v oldValue/newValue,
      // seznam polí se vejde jen do `field` — VARCHAR(191), proto truncateUtf8).
      const touchesPosition = "startTime" in op.fields || "endTime" in op.fields || "machine" in op.fields;
      const otherKeys = Object.keys(op.fields).filter((k) => !POSITION_FIELD_KEYS.has(k)).sort();
      let field: string;
      let oldValue: string | null;
      let newValue: string | null;
      if (touchesPosition) {
        oldValue = span(row.startTime, row.endTime);
        newValue = span(saved.startTime, saved.endTime);
        field = otherKeys.length > 0
          ? truncateUtf8(UNDO_MIXED_FIELD_PREFIX + otherKeys.join(", "), AUDIT_MIXED_FIELD_MAX_BYTES)
          : "startTime/endTime/machine";
      } else {
        field = "fields";
        oldValue = null;
        newValue = otherKeys.length > 0 ? otherKeys.join(", ") : null;
      }
      auditRows.push({
        blockId: op.id, orderNumber: saved.orderNumber, userId: actor.id, username: actor.username,
        action: direction === "undo" ? "UNDO" : "REDO",
        field, oldValue, newValue,
      });
      await warnIfUnusual(tx, op, saved);
    } else {
      // Obnova s PŮVODNÍM id — historie v AuditLogu a notifikace zůstanou
      // navázané. MySQL AUTO_INCREMENT se explicitním vložením nižší hodnoty
      // nesnižuje, takže budoucí kolize nehrozí.
      const saved = await tx.block.create({ data: { ...data, id: op.id } as never });
      result.createdIds.push(op.id);
      addToMachine(saved.machine, op.id);
      auditRows.push({
        blockId: op.id, orderNumber: saved.orderNumber, userId: actor.id, username: actor.username,
        action: direction === "undo" ? "UNDO" : "REDO",
        field: "restore", oldValue: null, newValue: span(saved.startTime, saved.endTime),
      });
      await warnIfUnusual(tx, op, saved);
    }
  }

  if (auditRows.length > 0) await tx.auditLog.createMany({ data: auditRows as never });

  // ── 5. Finální pojistka — běží VŽDY, bez únikové cesty ───────────────────
  // Stroje z CÍLOVÉHO stavu, každý jen se svými id: funkce filtruje `machine = ?`,
  // takže přesun na jiný stroj musí kontrolovat ten nový, a id musí patřit tomu
  // stroji, který se zrovna kontroluje (jinak by srovnávala časová okna napříč
  // nesouvisejícími stroji). Stroje, ze kterých se jen odcházelo, kontrolu
  // nepotřebují — uvolněné místo překryv nevyrobí.
  //
  // D4 (go/no-go audit 5. 8. 2026): stroje se prochází SEŘAZENÉ podle jména,
  // ne v pořadí vložení do Map. Dvě souběžné undo dávky přes tytéž dva stroje
  // v OPAČNÉM pořadí operací by si jinak mohly zaklínit zámky (dávka A drží
  // zámek XL_105 a čeká na XL_106, dávka B naopak) — klasický deadlock
  // z nekonzistentního pořadí zamykání. Seřazené pořadí je globálně stejné
  // pro každou transakci, takže se nemůže stát.
  for (const machine of [...idsByMachine.keys()].sort()) {
    await assertNoOverlapForBlocks(machine, idsByMachine.get(machine)!, tx);
  }

  // Logování záměrně NENÍ tady. Funkce běží uvnitř `prisma.$transaction` — log
  // napsaný tady by přežil i rollback (výjimka odjinud v téže transakci, nebo
  // pád commitu samotného) a tvářil by se jako proběhlé undo, které se ve
  // skutečnosti nestalo. Parita se zbytkem `*.server.ts` v repu (reflow.server.ts
  // apod.) — logování dělá až volající route PO commitu, z vráceného `result`.
  return result;
}

/**
 * Datumové sloupce přicházejí jako ISO string; Prisma chce Date.
 * Exportováno jen kvůli tripwire testu (undoApply.server.test.ts) — nový
 * DateTime sloupec přidaný do UNDO_RESTORABLE_FIELDS bez odpovídajícího
 * zápisu sem by poslal ISO string místo Date do Prisma a spadl by na 500.
 */
export const DATE_FIELDS = new Set([
  "startTime", "endTime", "deadlineExpedice", "dataRequiredDate",
  "materialRequiredDate", "pantoneRequiredDate", "expeditionPublishedAt",
]);

function toPrismaData(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

/**
 * Obnova mimo mřížku i obnova do firemní odstávky jsou legitimní (legacy bloky
 * / vědomý zásah plánovače), ale produkce o obojím má vědět (spec, sekce 5 —
 * „Co se jen loguje, neblokuje"). D3 (go/no-go audit 5. 8. 2026): odstávkové
 * varování v návrhu bylo, implementované nebylo — doplněno vedle mřížkového.
 *
 * Odstávkový check běží JEN když operace doopravdy restartuje pozici
 * (`startTime`/`endTime` v `op.fields`) — u čistě obchodní editace (např. undo
 * změny `materialStatusId`) by warn o pozici, kterou undo vůbec nezměnilo, byl
 * jen šum. Používá `saved` (stav PO zápisu, plně vyřešený i pro update, který
 * mění jen jedno z dvojice start/end) — ne `op.fields`, který u update může mít
 * jen polovinu páru.
 */
async function warnIfUnusual(
  tx: PrismaTransactionClient,
  op: Extract<UndoOp, { kind: "upsert" }>,
  saved: { startTime: Date; endTime: Date; machine: string },
): Promise<void> {
  const start = op.fields.startTime;
  if (typeof start === "string") {
    const t = new Date(start).getTime();
    if (!Number.isNaN(t) && t % SLOT_MS !== 0) {
      logger.warn(`[undo] blok ${op.id} obnoven na start mimo 30min mřížku (${start}) — legacy blok před modelem tiskových hodin`);
    }
  }
  if ("startTime" in op.fields || "endTime" in op.fields) {
    const cal = await loadMachineCalendarRange(tx, saved.machine, saved.startTime, saved.endTime);
    const hit = cal.companyDays.find((c) => c.start < saved.endTime && c.end > saved.startTime);
    if (hit) {
      logger.warn(`[undo] blok ${op.id} obnoven do firemní odstávky (${hit.start.toISOString()}–${hit.end.toISOString()})`);
    }
  }
}
