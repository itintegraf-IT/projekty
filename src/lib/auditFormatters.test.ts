import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtAuditVal, classifyUndoRedoField, UNDO_MIXED_FIELD_PREFIX } from "@/lib/auditFormatters";
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
