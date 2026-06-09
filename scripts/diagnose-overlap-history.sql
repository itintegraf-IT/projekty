-- =====================================================================
-- HISTORIE 4 reálných překryvů (read-only). Bloky:
--   XL_105: 219/287, 222/295, 216/223   |   XL_106: 233/314
-- Spustit:
--   sudo mysql igvyroba --table < /tmp/diagnose-overlap-history.sql > /tmp/diag-history.txt 2>&1
-- =====================================================================

SELECT '=== 1: Kompletní audit historie všech 8 zapojených bloků ===' AS info;
SELECT
  al.blockId, al.orderNumber,
  DATE_FORMAT(al.createdAt, '%Y-%m-%d %H:%i:%s') AS cas,
  al.username, al.action, al.field,
  LEFT(al.newValue, 52) AS new_val
FROM AuditLog al
WHERE al.blockId IN (216, 222, 223, 295, 219, 287, 233, 314)
ORDER BY al.blockId, al.createdAt;

SELECT '=== 2: Časová osa 14.4. 12:25-12:35 (batch co zapsala překryv 216/223 + 222/295) ===' AS info;
SELECT
  DATE_FORMAT(al.createdAt, '%m-%d %H:%i:%s') AS cas,
  al.blockId, al.orderNumber, al.username, al.action, al.field,
  LEFT(al.newValue, 50) AS new_val
FROM AuditLog al
WHERE al.createdAt >= '2026-04-14 12:25:00' AND al.createdAt <= '2026-04-14 12:35:00'
ORDER BY al.createdAt, al.blockId;

SELECT '=== 3: Časová osa 17.3. 12:00-12:25 (vznik bloku 314 na 233 — XL_106) ===' AS info;
SELECT
  DATE_FORMAT(al.createdAt, '%m-%d %H:%i:%s') AS cas,
  al.blockId, al.orderNumber, al.username, al.action, al.field,
  LEFT(al.newValue, 50) AS new_val
FROM AuditLog al
WHERE al.createdAt >= '2026-03-17 12:00:00' AND al.createdAt <= '2026-03-17 12:25:00'
ORDER BY al.createdAt, al.blockId;

SELECT '=== 4: Časová osa 19.3. kolem bloku 219 (r4711) — pár 219/287 ===' AS info;
SELECT
  DATE_FORMAT(al.createdAt, '%m-%d %H:%i:%s') AS cas,
  al.blockId, al.orderNumber, al.username, al.action, al.field,
  LEFT(al.newValue, 50) AS new_val
FROM AuditLog al
WHERE al.createdAt >= '2026-03-19 19:45:00' AND al.createdAt <= '2026-03-19 20:00:00'
ORDER BY al.createdAt, al.blockId;

SELECT '=== 5: Aktuální stav 8 bloků (pro kontext) ===' AS info;
SELECT
  id, machine, orderNumber, locked,
  DATE_FORMAT(startTime, '%Y-%m-%d %H:%i') AS startT,
  DATE_FORMAT(endTime,   '%Y-%m-%d %H:%i') AS endT,
  DATE_FORMAT(createdAt, '%m-%d %H:%i') AS created,
  DATE_FORMAT(updatedAt, '%m-%d %H:%i') AS updated
FROM Block
WHERE id IN (216, 222, 223, 295, 219, 287, 233, 314)
ORDER BY machine, startTime;
