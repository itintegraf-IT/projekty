-- Produkční DB měla AuditLog.action jako varchar(16) místo varchar(191).
-- Sloupec byl opravena ručně 12. 4. 2026, tato migrace to formalizuje.
-- Na produkci byl ALTER TABLE spuštěn manuálně před deploym.
ALTER TABLE `AuditLog` MODIFY COLUMN `action` VARCHAR(191) NOT NULL;
