-- =====================================================================
-- DIAGNOSTIKA PŘEKRÝVAJÍCÍCH SE ZAKÁZEK (read-only, nic nezapisuje)
-- Spustit na PRODUKCI:  sudo mysql igvyroba --table < scripts/diagnose-overlaps.sql > /tmp/overlap-diagnostika.txt 2>&1
-- Pak pošli soubor /tmp/overlap-diagnostika.txt zpět.
-- Obsahuje JEN SELECTy. Žádné UPDATE/DELETE/INSERT. Bezpečné.
-- =====================================================================

SELECT '=== 0: KONTEXT (čas serveru + databáze) ===' AS info;
SELECT NOW() AS server_now, DATABASE() AS db;

-- ---------------------------------------------------------------------
-- 1) VŠECHNY překrývající se ZAKAZKA páry na stejném stroji.
--    Definice překryvu: a.start < b.end AND b.start < a.end
--    (dotyk koncem == začátkem se NEpočítá jako překryv).
--    Sloupce *_locked, *_rec (recurrenceParentId), *_split (splitGroupId)
--    pomůžou poznat, jestli překryvy souvisí se zamčenými bloky / sériemi / splity.
-- ---------------------------------------------------------------------
SELECT '=== 1: PŘEKRÝVAJÍCÍ SE ZAKAZKA PÁRY ===' AS info;
SELECT
  a.machine,
  a.id  AS id_a, a.orderNumber AS ord_a,
  DATE_FORMAT(a.startTime, '%Y-%m-%d %H:%i') AS a_start,
  DATE_FORMAT(a.endTime,   '%Y-%m-%d %H:%i') AS a_end,
  b.id  AS id_b, b.orderNumber AS ord_b,
  DATE_FORMAT(b.startTime, '%Y-%m-%d %H:%i') AS b_start,
  DATE_FORMAT(b.endTime,   '%Y-%m-%d %H:%i') AS b_end,
  TIMESTAMPDIFF(MINUTE, GREATEST(a.startTime, b.startTime), LEAST(a.endTime, b.endTime)) AS overlap_min,
  a.locked AS a_lock, b.locked AS b_lock,
  a.recurrenceParentId AS a_rec, b.recurrenceParentId AS b_rec,
  a.splitGroupId AS a_split, b.splitGroupId AS b_split,
  DATE_FORMAT(a.updatedAt, '%Y-%m-%d %H:%i') AS a_updated,
  DATE_FORMAT(b.updatedAt, '%Y-%m-%d %H:%i') AS b_updated
FROM Block a
JOIN Block b
  ON  a.machine = b.machine
  AND a.id < b.id
  AND a.startTime < b.endTime
  AND b.startTime < a.endTime
WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
ORDER BY a.machine, a.startTime;

-- ---------------------------------------------------------------------
-- 2) SOUHRN: kolik párů celkem, kolik v budoucnu vs. minulosti.
--    Potvrdí symptom "hlavně budoucí týden/měsíc".
-- ---------------------------------------------------------------------
SELECT '=== 2: SOUHRN (budoucí vs. minulé) ===' AS info;
SELECT
  COUNT(*) AS prekryvajicich_paru,
  SUM(CASE WHEN GREATEST(a.startTime, b.startTime) >= NOW() THEN 1 ELSE 0 END) AS budouci_pary,
  SUM(CASE WHEN GREATEST(a.startTime, b.startTime) <  NOW() THEN 1 ELSE 0 END) AS minule_pary,
  SUM(CASE WHEN a.locked = 1 OR b.locked = 1 THEN 1 ELSE 0 END) AS pary_se_zamcenym_blokem,
  SUM(CASE WHEN a.recurrenceParentId IS NOT NULL OR b.recurrenceParentId IS NOT NULL THEN 1 ELSE 0 END) AS pary_se_serii,
  SUM(CASE WHEN a.splitGroupId IS NOT NULL OR b.splitGroupId IS NOT NULL THEN 1 ELSE 0 END) AS pary_se_splitem
FROM Block a
JOIN Block b
  ON  a.machine = b.machine
  AND a.id < b.id
  AND a.startTime < b.endTime
  AND b.startTime < a.endTime
WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA';

-- ---------------------------------------------------------------------
-- 3) AUDIT LOG pro všechny bloky zapojené do překryvu.
--    POZN.: jednotlivý PUT (drag/resize) NEzapisuje audit pro změnu času,
--    takže tady uvidíš hlavně batch posuny (field='startTime/endTime/machine')
--    a změny stavů. I tak ukáže, kdo a kdy s bloky hýbal.
-- ---------------------------------------------------------------------
SELECT '=== 3: AUDIT LOG zapojených bloků ===' AS info;
WITH ov AS (
  SELECT a.id AS ida, b.id AS idb
  FROM Block a JOIN Block b
    ON  a.machine = b.machine AND a.id < b.id
    AND a.startTime < b.endTime AND b.startTime < a.endTime
  WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
),
ids AS (SELECT ida AS id FROM ov UNION SELECT idb AS id FROM ov)
SELECT
  al.blockId, al.orderNumber,
  DATE_FORMAT(al.createdAt, '%Y-%m-%d %H:%i:%s') AS kdy,
  al.username, al.action, al.field,
  LEFT(al.oldValue, 60) AS old_val,
  LEFT(al.newValue, 60) AS new_val
FROM AuditLog al
JOIN ids ON al.blockId = ids.id
ORDER BY al.blockId, al.createdAt;

-- ---------------------------------------------------------------------
-- 4) METADATA zapojených bloků (locked, série, split, kdy vytvořeno/změněno).
-- ---------------------------------------------------------------------
SELECT '=== 4: METADATA zapojených bloků ===' AS info;
WITH ov AS (
  SELECT a.id AS ida, b.id AS idb
  FROM Block a JOIN Block b
    ON  a.machine = b.machine AND a.id < b.id
    AND a.startTime < b.endTime AND b.startTime < a.endTime
  WHERE a.type = 'ZAKAZKA' AND b.type = 'ZAKAZKA'
),
ids AS (SELECT ida AS id FROM ov UNION SELECT idb AS id FROM ov)
SELECT
  bl.id, bl.machine, bl.orderNumber, bl.type, bl.locked,
  bl.recurrenceType, bl.recurrenceParentId AS rec_parent, bl.splitGroupId AS split_grp,
  DATE_FORMAT(bl.startTime, '%Y-%m-%d %H:%i') AS startT,
  DATE_FORMAT(bl.endTime,   '%Y-%m-%d %H:%i') AS endT,
  DATE_FORMAT(bl.createdAt, '%Y-%m-%d %H:%i') AS createdT,
  DATE_FORMAT(bl.updatedAt, '%Y-%m-%d %H:%i') AS updatedT,
  DATE_FORMAT(bl.printCompletedAt, '%Y-%m-%d %H:%i') AS printDone
FROM Block bl
JOIN ids ON bl.id = ids.id
ORDER BY bl.machine, bl.startTime;

-- ---------------------------------------------------------------------
-- 5) Posledních 100 změn PRACOVNÍ DOBY (MachineWeekShifts).
--    Auditní řádky mají blockId=0, field='MachineWeekShifts'.
--    Pomůže zkorelovat, jestli překryvy vznikají po změně pracovní doby.
-- ---------------------------------------------------------------------
SELECT '=== 5: Posledních 100 změn pracovní doby ===' AS info;
SELECT
  DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS kdy,
  username,
  LEFT(oldValue, 50) AS old_val,
  LEFT(newValue, 70) AS new_val
FROM AuditLog
WHERE field = 'MachineWeekShifts'
ORDER BY createdAt DESC
LIMIT 100;

-- ---------------------------------------------------------------------
-- 6) Celkový počet bloků (kontext velikosti dat).
-- ---------------------------------------------------------------------
SELECT '=== 6: Počty bloků ===' AS info;
SELECT type, COUNT(*) AS pocet FROM Block GROUP BY type ORDER BY pocet DESC;

-- ---------------------------------------------------------------------
-- 7) Konkrétní zakázka, kterou plánovač nahlásil jako překrytou (18153).
--    Plánovač ji prý už opravil, ale historie v audit logu ukáže,
--    JAK vznikla a co s ní hýbalo (potvrdí mechanismus).
--    Číslo můžeš změnit, nebo přidat další přes OR orderNumber LIKE '...%'.
-- ---------------------------------------------------------------------
SELECT '=== 7: Stav zakázky 18153 ===' AS info;
SELECT
  id, machine, orderNumber, type, locked,
  recurrenceType, recurrenceParentId AS rec_parent, splitGroupId AS split_grp,
  DATE_FORMAT(startTime, '%Y-%m-%d %H:%i') AS startT,
  DATE_FORMAT(endTime,   '%Y-%m-%d %H:%i') AS endT,
  DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i') AS createdT,
  DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i') AS updatedT
FROM Block
WHERE orderNumber LIKE '18153%'
ORDER BY startTime;

SELECT '=== 7b: Audit log zakázky 18153 ===' AS info;
SELECT
  al.blockId, al.orderNumber,
  DATE_FORMAT(al.createdAt, '%Y-%m-%d %H:%i:%s') AS kdy,
  al.username, al.action, al.field,
  LEFT(al.oldValue, 60) AS old_val,
  LEFT(al.newValue, 60) AS new_val
FROM AuditLog al
WHERE al.orderNumber LIKE '18153%'
   OR al.blockId IN (SELECT id FROM Block WHERE orderNumber LIKE '18153%')
ORDER BY al.blockId, al.createdAt;
