-- Rozšíření oldValue/newValue z VARCHAR(191) na TEXT,
-- aby se vešel plný encodeDay payload (~200+ znaků pro týden s overrides).
ALTER TABLE `AuditLog` MODIFY `oldValue` TEXT NULL;
ALTER TABLE `AuditLog` MODIFY `newValue` TEXT NULL;
