import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK_RELATION_FIELDS, BLOCK_INBOUND_RELATION_FIELDS } from "./blockColumns";

// Cesta k tomuto souboru, ne k `process.cwd()` — stejná konvence jako
// v rowNormalize.test.ts, ať test najde schema.prisma bez ohledu na to,
// odkud se `node --test` spouští.
const testDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(testDir, "../../../prisma/schema.prisma");

/** Jména všech modelů ve schématu — podle nich se pozná relační pole od skalárního. */
function modelNames(schema: string): Set<string> {
  return new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
}

/** Relační pole modelu: typ je jméno modelu (volitelně `?` nebo `[]`). */
function relationFieldsOf(schema: string, model: string): string[] {
  const body = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  assert.ok(body, `model ${model} nenalezen v prisma/schema.prisma`);
  const models = modelNames(schema);
  const out: string[] = [];
  for (const line of body!.split("\n")) {
    const m = line.trim().match(/^(\w+)\s+(\w+)(\[\])?\??(\s|$)/);
    if (!m) continue;
    const [, field, type] = m;
    if (models.has(type)) out.push(field);
  }
  return out;
}

test("BLOCK_RELATION_FIELDS odpovídá SKUTEČNÉMU schema.prisma (oba směry)", () => {
  // JSDoc u BLOCK_RELATION_FIELDS slibuje: „když přibude relace, MUSÍ přibýt
  // i sem." Bez téhle kontroly to hlídá jen komentář — a nová relace by tiše
  // otevřela cestu, jak vnořeným zápisem měnit bloky mimo revizi. Táž třída
  // selhání jako u AUDITED_FIELDS, která v repu reálně znemožnila rekonstrukci
  // havárií plánu z 5.–6. 8. 2026.
  const schema = readFileSync(schemaPath, "utf8");
  const actual = relationFieldsOf(schema, "Block").sort();
  assert.deepEqual(
    [...BLOCK_RELATION_FIELDS].sort(),
    actual,
    "BLOCK_RELATION_FIELDS se rozešlo se schématem — doplň/uber pole v src/lib/revision/blockColumns.ts",
  );
});

test("BLOCK_INBOUND_RELATION_FIELDS pokrývá všechny cesty z jiných modelů do Block", () => {
  // Modely s relací na Block (dnes SplitGroup.blocks, Reservation.blocks,
  // BlockNote.block) se přes withRevision propouštějí, ale s kontrolou
  // vnořeného zápisu. Kdyby přibyl model s relací na Block pod JINÝM jménem
  // pole, kontrola by ho minula.
  const schema = readFileSync(schemaPath, "utf8");
  const models = [...modelNames(schema)].filter((m) => m !== "Block");
  const inbound = new Set<string>();
  for (const model of models) {
    const body = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1];
    if (!body) continue;
    for (const line of body.split("\n")) {
      const m = line.trim().match(/^(\w+)\s+Block(\[\])?\??(\s|$)/);
      if (m) inbound.add(m[1]);
    }
  }
  const missing = [...inbound].filter((f) => !(BLOCK_INBOUND_RELATION_FIELDS as readonly string[]).includes(f));
  assert.deepEqual(
    missing,
    [],
    `Do Block vede relační pole, které BLOCK_INBOUND_RELATION_FIELDS nezná: ${missing.join(", ")}`,
  );
});
