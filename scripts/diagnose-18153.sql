-- =====================================================================
-- DIAGNOSTIKA: proč se přesouval blok 18153 (read-only, jen SELECTy)
-- Spustit na PRODUKCI:
--   sudo mysql igvyroba --table < /tmp/diagnose-18153.sql > /tmp/diag-18153.txt 2>&1
-- Pak pošli /tmp/diag-18153.txt zpět.
-- =====================================================================

SELECT '=== 1: Bloky kolem 18153 (XL_105 + XL_106, 15.-17.6.) — s čím mohl kolidovat ===' AS info;
SELECT
  id, machine, orderNumber, type, locked,
  DATE_FORMAT(startTime, '%Y-%m-%d %H:%i') AS startT,
  DATE_FORMAT(endTime,   '%Y-%m-%d %H:%i') AS endT,
  recurrenceParentId AS rec, splitGroupId AS spl,
  DATE_FORMAT(createdAt, '%m-%d %H:%i') AS created,
  DATE_FORMAT(updatedAt, '%m-%d %H:%i') AS updated
FROM Block
WHERE machine IN ('XL_105', 'XL_106')
  AND startTime >= '2026-06-15 00:00:00'
  AND startTime <  '2026-06-18 00:00:00'
ORDER BY machine, startTime;

SELECT '=== 2: KOMPLETNÍ časová osa 8.6. 09:50-12:10 (VŠECHNY bloky) — co se dělo ===' AS info;
-- Bloky se stejným časem = jedna batch operace (jeden automatický úklid).
-- Uvidíme, které bloky se posouvaly SPOLEČNĚ s 18153.
SELECT
  DATE_FORMAT(al.createdAt, '%H:%i:%s') AS cas,
  al.blockId, al.orderNumber, al.username, al.action, al.field,
  LEFT(al.newValue, 52) AS new_val
FROM AuditLog al
WHERE al.createdAt >= '2026-06-08 09:50:00'
  AND al.createdAt <= '2026-06-08 12:10:00'
ORDER BY al.createdAt, al.blockId;

SELECT '=== 3: Kompletní historie bloku 18153 (celý život) ===' AS info;
SELECT
  DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS cas,
  username, action, field,
  LEFT(oldValue, 48) AS old_val,
  LEFT(newValue, 52) AS new_val
FROM AuditLog
WHERE orderNumber LIKE '18153%'
   OR blockId IN (SELECT id FROM Block WHERE orderNumber LIKE '18153%')
ORDER BY createdAt;

SELECT '=== 4: Změny pracovní doby XL_105/XL_106 kolem 8.6. (mohly spustit posun) ===' AS info;
SELECT
  DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS cas,
  username, LEFT(newValue, 60) AS new_val
FROM AuditLog
WHERE field = 'MachineWeekShifts'
  AND createdAt >= '2026-06-01 00:00:00'
  AND createdAt <= '2026-06-09 00:00:00'
ORDER BY createdAt DESC;
