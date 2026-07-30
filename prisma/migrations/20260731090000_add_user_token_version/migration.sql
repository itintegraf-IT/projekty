-- AlterTable: verze session tokenů pro revokaci (audit SEC-03 / A-2).
-- getSession() porovnává tokenVersion z JWT proti DB (s 30s cache) — bump
-- při změně role/hesla/smazání účtu zneplatní všechny vydané tokeny uživatele.
-- Bez FK, bez indexu (čte se přes PK). Default 0 = stávající tokeny (bez
-- claimu) zůstávají platné, dokud se verze nebumpne.
ALTER TABLE `User` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;
