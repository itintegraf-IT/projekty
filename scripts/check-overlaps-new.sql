-- =====================================================================
-- KONTROLA NOVÝCH překryvů (read-only).
--
-- Vynechává 3 VĚDOMĚ PONECHANÉ staré překryvy z března 2026 (z doby PŘED
-- nasazením opravy 9. 6. 2026 — minulé tisky, neřeší se):
--   219/287, 222/295, 216/223 (XL_105) — bloky 219,287,222,295,216,223.
--
-- VÝSLEDEK:
--   Sekce "Souhrn" = 0  →  žádný NOVÝ překryv  →  oprava drží, nic neřeš.
--   Sekce "Souhrn" > 0  →  NOVÝ překryv k prozkoumání (buď oprava na nějaké
--                          cestě nezafungovala, nebo vznikl jinak — pošli mi to).
--
-- Spustit na produkci:
--   sudo mysql igvyroba --table < scripts/check-overlaps-new.sql
--
-- Pozn.: pokud někdy ty 3 staré uklidíš (nebo přibudou další vědomě ponechané),
-- uprav seznam id v obou `IN (...)` níže.
-- =====================================================================

SELECT '=== NOVÉ překryvy (mimo 3 známé staré z března) ===' AS info;
SELECT
  a.machine,
  a.id AS id_a, a.orderNumber AS ord_a,
  DATE_FORMAT(a.startTime, '%Y-%m-%d %H:%i') AS a_start,
  DATE_FORMAT(a.endTime,   '%H:%i') AS a_end,
  b.id AS id_b, b.orderNumber AS ord_b,
  DATE_FORMAT(b.startTime, '%Y-%m-%d %H:%i') AS b_start,
  DATE_FORMAT(b.endTime,   '%H:%i') AS b_end,
  TIMESTAMPDIFF(MINUTE, GREATEST(a.startTime, b.startTime), LEAST(a.endTime, b.endTime)) AS overlap_min,
  DATE_FORMAT(a.updatedAt, '%Y-%m-%d %H:%i') AS a_updated,
  DATE_FORMAT(b.updatedAt, '%Y-%m-%d %H:%i') AS b_updated
FROM Block a
JOIN Block b ON a.machine = b.machine AND a.id < b.id
  AND a.startTime < b.endTime AND b.startTime < a.endTime
WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
  -- vynech pár, kde OBA bloky patří mezi 3 vědomě ponechané staré:
  AND NOT (a.id IN (219, 287, 222, 295, 216, 223) AND b.id IN (219, 287, 222, 295, 216, 223))
ORDER BY a.machine, a.startTime;

SELECT '=== Souhrn: počet NOVÝCH překryvů (musí být 0) ===' AS info;
SELECT COUNT(*) AS novych_prekryvu
FROM Block a
JOIN Block b ON a.machine = b.machine AND a.id < b.id
  AND a.startTime < b.endTime AND b.startTime < a.endTime
WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
  AND NOT (a.id IN (219, 287, 222, 295, 216, 223) AND b.id IN (219, 287, 222, 295, 216, 223));

SELECT '=== (pro kontext) 3 vědomě ponechané staré páry ===' AS info;
SELECT a.machine, a.id AS id_a, a.orderNumber AS ord_a, b.id AS id_b, b.orderNumber AS ord_b
FROM Block a
JOIN Block b ON a.machine = b.machine AND a.id < b.id
  AND a.startTime < b.endTime AND b.startTime < a.endTime
WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
  AND a.id IN (219, 287, 222, 295, 216, 223) AND b.id IN (219, 287, 222, 295, 216, 223)
ORDER BY a.machine, a.startTime;
