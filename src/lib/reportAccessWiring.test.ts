import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test přístupu do reportů (etapa 2 září 2026, volba R1 = A).
 *
 * Modul `/reporty` drží na rolích SEDM míst a autorizaci reportů do téhle etapy
 * nehlídal ani jeden test. Middleware navíc `/api/report/attention` ani
 * `/api/report/health` vůbec nejmenuje — obě stojí čistě na `requireRole` uvnitř
 * routy. Rozpojené jedno místo se tedy neprojeví chybou, ale tím, že plánovači
 * funguje jen část stránky: karty se načtou a stavový pás mlčí.
 *
 * Sdílená konstanta rolí v projektu neexistuje (každý modul si pole opisuje) a
 * tahle etapa ten zvyk nemění — proto ten výčet hlídá test, ne typový systém.
 */
const middleware = stripComments(readFileSync("src/middleware.ts", "utf8"));
const page = stripComments(readFileSync("src/app/reporty/page.tsx", "utf8"));
const dashboard = stripComments(readFileSync("src/app/api/report/dashboard/route.ts", "utf8"));
const attention = stripComments(readFileSync("src/app/api/report/attention/route.ts", "utf8"));
const health = stripComments(readFileSync("src/app/api/report/health/route.ts", "utf8"));
const planner = stripComments(readFileSync("src/app/_components/PlannerPage.tsx", "utf8"));

const ROLES = String.raw`\["ADMIN",\s*"PLANOVAT"\]`;

test("middleware pouští do /reporty i /api/report/dashboard ADMIN i PLANOVAT", () => {
  assert.match(middleware, new RegExp(String.raw`startsWith\("/reporty"\)[\s\S]{0,200}?${ROLES}`));
  assert.match(middleware, new RegExp(String.raw`startsWith\("/api/report/dashboard"\)[\s\S]{0,200}?${ROLES}`));
  assert.doesNotMatch(middleware, /startsWith\("\/reporty"\)[\s\S]{0,200}?role !== "ADMIN"/);
  assert.doesNotMatch(middleware, /startsWith\("\/api\/report\/dashboard"\)[\s\S]{0,200}?role !== "ADMIN"/);
});

test("stránka /reporty má druhou vrstvu se stejným výčtem", () => {
  assert.match(page, new RegExp(String.raw`${ROLES}\.includes\(session\.role\)`));
  assert.doesNotMatch(page, /session\.role !== "ADMIN"/);
});

test("všechny tři reportové API pouštějí ADMIN i PLANOVAT", () => {
  assert.match(dashboard, new RegExp(String.raw`ALLOWED_ROLES = new Set\(${ROLES}\)`));
  assert.match(attention, new RegExp(String.raw`requireRole\(${ROLES}\)`));
  assert.match(health, new RegExp(String.raw`requireRole\(${ROLES}\)`));
});

test("odkaz Reporty v hlavičce planneru se řídí týmž výčtem", () => {
  assert.match(planner, new RegExp(String.raw`${ROLES}\.includes\(currentUser\.role\)[\s\S]{0,200}?href="/reporty"`));
  assert.doesNotMatch(planner, /currentUser\.role === "ADMIN"[\s\S]{0,200}?href="\/reporty"/);
});
