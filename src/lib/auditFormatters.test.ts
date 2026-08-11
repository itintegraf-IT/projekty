import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtAuditVal, classifyUndoRedoField, UNDO_MIXED_FIELD_PREFIX, FIELD_LABELS } from "@/lib/auditFormatters";
import { formatPragueDateTime } from "@/lib/dateUtils";
import { SPLIT_SHARED_FIELDS } from "@/lib/splitSharedFields";

test("Fix round 1: pantoneOk se formátuje jako ✓ OK / ✗ Ne (dřív spadlo na syrové true/false)", () => {
  assert.equal(fmtAuditVal("true", "pantoneOk"), "✓ OK");
  assert.equal(fmtAuditVal("false", "pantoneOk"), "✗ Ne");
});

test("dataOk/materialOk zůstávají ve stejné skupině jako pantoneOk (✓ OK / ✗ Ne) — beze změny chování", () => {
  assert.equal(fmtAuditVal("true", "dataOk"), "✓ OK");
  assert.equal(fmtAuditVal("false", "dataOk"), "✗ Ne");
  assert.equal(fmtAuditVal("true", "materialOk"), "✓ OK");
  assert.equal(fmtAuditVal("false", "materialOk"), "✗ Ne");
});

test("materialInStock/materialIssued zůstávají ve skupině ✓ Ano / ✗ Ne — beze změny chování", () => {
  assert.equal(fmtAuditVal("true", "materialInStock"), "✓ Ano");
  assert.equal(fmtAuditVal("false", "materialInStock"), "✗ Ne");
  assert.equal(fmtAuditVal("true", "materialIssued"), "✓ Ano");
  assert.equal(fmtAuditVal("false", "materialIssued"), "✗ Ne");
});

test("Fix round 1: žádné boolean pole ze SPLIT_SHARED_FIELDS nezůstává na syrovém true/false", () => {
  // Ručně sestavený seznam boolean sloupců Blocku, které jsou zároveň v SPLIT_SHARED_FIELDS —
  // cross-checked proti prisma/schema.prisma při Fix round 1 (8/2026), přesně tahle otázka
  // ("je ve stejné situaci ještě další pole?") odhalila, že chybí jen pantoneOk.
  // Nový boolean sloupec přidaný do SPLIT_SHARED_FIELDS se sem musí doplnit vědomě —
  // asserce níže na členství v SPLIT_SHARED_FIELDS hlídá, že se tenhle seznam sám nerozejde.
  const knownBooleanSplitFields = [
    "dataOk", "materialOk", "materialInStock", "materialIssued", "pantoneOk", "pantoneRequired",
    "pantoneInStock", "pantoneIssued",
  ];
  for (const field of knownBooleanSplitFields) {
    assert.ok(
      (SPLIT_SHARED_FIELDS as readonly string[]).includes(field),
      `${field} musí být v SPLIT_SHARED_FIELDS (aktualizuj seznam v testu, pokud se schéma změnilo)`
    );
    assert.notEqual(fmtAuditVal("true", field), "true", `${field}: hodnota "true" se vykresluje syrově`);
    assert.notEqual(fmtAuditVal("false", field), "false", `${field}: hodnota "false" se vykresluje syrově`);
  }
});

// ─── classifyUndoRedoField (fix round 1 — review: smíšený audit řádek ztrácel
// business pole, protože binární klasifikace "buď span, nebo seznam polí"
// smíšený zápis (kotva nese obojí, mergeAnchorPositionIfChanged) vybrala jako
// poziční a seznam polí zahodila) ────────────────────────────────────────────

test("Fix round 1: classifyUndoRedoField — čistě poziční marker → kind position", () => {
  assert.deepEqual(classifyUndoRedoField("startTime/endTime/machine", null), { kind: "position" });
});

test("Fix round 1: classifyUndoRedoField — field null (žádný záznam) → fallback na position", () => {
  // Stejný katch-all jako dřívější `field !== "fields"` — position je výchozí stav
  // pro cokoli, co není rozpoznaný marker "fields" ani prefix smíšeného zápisu.
  assert.deepEqual(classifyUndoRedoField(null, null), { kind: "position" });
});

test("Fix round 1: classifyUndoRedoField — čistě polní marker → kind fields, klíče ze seznamu v newValue", () => {
  assert.deepEqual(classifyUndoRedoField("fields", "dataOk, pantoneOk"), { kind: "fields", keys: ["dataOk", "pantoneOk"] });
});

test("Fix round 1: classifyUndoRedoField — čistě polní marker s prázdným/chybějícím newValue → prázdné keys, ne pád", () => {
  assert.deepEqual(classifyUndoRedoField("fields", null), { kind: "fields", keys: [] });
});

test("Fix round 1: classifyUndoRedoField — smíšený prefix s JEDNÍM polem → kind mixed, keys má přesně to pole", () => {
  assert.deepEqual(classifyUndoRedoField(`${UNDO_MIXED_FIELD_PREFIX}description`, null), { kind: "mixed", keys: ["description"] });
});

test("Fix round 1: classifyUndoRedoField — smíšený prefix s VÍC poli → keys rozdělené podle ', '", () => {
  assert.deepEqual(
    classifyUndoRedoField(`${UNDO_MIXED_FIELD_PREFIX}dataOk, pantoneOk`, null),
    { kind: "mixed", keys: ["dataOk", "pantoneOk"] },
  );
});

test("Fix round 1: classifyUndoRedoField — smíšený prefix BEZ zbytku (krajní případ extrémního ořezu) → kind mixed, keys prázdné (ne [''])", () => {
  // Teoretický okraj: kdyby truncateUtf8 na straně writeru useknul úplně všechno za
  // prefixem, split by na prázdném stringu vrátil [""] (falešné jedno "pole"), ne [].
  // MUTAČNÍ POJISTKA: kdyby classifyUndoRedoField nekontrolovalo rest.length > 0 před
  // split, tenhle test by dostal { kind: "mixed", keys: [""] } místo keys: [].
  assert.deepEqual(classifyUndoRedoField(UNDO_MIXED_FIELD_PREFIX, null), { kind: "mixed", keys: [] });
});

test("Fix round 1: classifyUndoRedoField — cizí/neznámá hodnota field (žádný marker) → fallback na position", () => {
  assert.deepEqual(classifyUndoRedoField("materialStatusId", null), { kind: "position" });
});

// ── O3: čitelnost starých auditních řádků (nález z proklikávání 9. 8. 2026) ──
// Řádky, které do `field` píší hromadné cesty, se v historii ukazovaly syrově:
// „startTime/endTime/machine: — → XL_105 2026-08-18T10:00:00.000Z–…".

test("O3: span s předsazeným strojem se naformátuje a stroj zůstane vepředu", () => {
  assert.equal(
    fmtAuditVal("XL_106 2026-08-18T10:00:00.000Z–2026-08-18T11:00:00.000Z", "startTime/endTime/machine"),
    `XL_106 ${formatPragueDateTime(new Date("2026-08-18T10:00:00.000Z"))} – ${formatPragueDateTime(new Date("2026-08-18T11:00:00.000Z"))}`,
  );
});

test("O3: span BEZ stroje se formátuje dál stejně (žádná regrese)", () => {
  assert.equal(
    fmtAuditVal("2026-08-18T10:00:00.000Z–2026-08-18T11:00:00.000Z", "startTime/endTime"),
    `${formatPragueDateTime(new Date("2026-08-18T10:00:00.000Z"))} – ${formatPragueDateTime(new Date("2026-08-18T11:00:00.000Z"))}`,
  );
});

test("O3: český free-text s pomlčkou se NESMÍ mis-formátovat na data", () => {
  // Původní guard chránil právě tohle — prefix se strojem ho nesmí prolomit.
  assert.equal(fmtAuditVal("dodávka 1–2", "expediceNote"), "dodávka 1–2");
  assert.equal(fmtAuditVal("Praha 1–2", "doprava"), "Praha 1–2");
  assert.equal(fmtAuditVal("XL_106 neco–jineho", "doprava"), "XL_106 neco–jineho");
});

test("O3: složené názvy polí mají český popisek", () => {
  assert.equal(FIELD_LABELS["startTime/endTime"], "Čas");
  assert.equal(FIELD_LABELS["startTime/endTime/machine"], "Čas a stroj");
});

test("N1: běžný český text se NESMÍ zobrazit jako datum (nález 9. 8. 2026)", () => {
  // new Date() tyhle řetězce doopravdy spolkne — bez striktního guardu se
  // popis zakázky v historii ukázal jako smyšlené datum z roku 2001.
  for (const text of ["TEST 2", "Tisk 4", "TISK 2000", "Tisk do PA 2", "Teplice 2", "Tiskarna 12", "STICKERS 5"]) {
    assert.equal(fmtAuditVal(text, "description"), text, `„${text}" se nesmí přeformátovat`);
  }
});

test("N1: skutečné ISO datum se dál formátuje (žádná regrese)", () => {
  assert.equal(
    fmtAuditVal("2026-08-18T10:00:00.000Z", "expeditionPublishedAt"),
    formatPragueDateTime(new Date("2026-08-18T10:00:00.000Z")),
  );
});
