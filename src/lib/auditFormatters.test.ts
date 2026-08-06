import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtAuditVal } from "@/lib/auditFormatters";
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
