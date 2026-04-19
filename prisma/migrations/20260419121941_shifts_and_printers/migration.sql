-- AlterTable: přidat směnové boolean sloupce do MachineWorkHoursTemplateDay
ALTER TABLE `MachineWorkHoursTemplateDay`
  ADD COLUMN `morningOn`   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `afternoonOn` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `nightOn`     BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: Printer (tiskaři pro rozpis směn)
CREATE TABLE `Printer` (
    `id`        INTEGER NOT NULL AUTO_INCREMENT,
    `name`      VARCHAR(191) NOT NULL,
    `isActive`  BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    INDEX `Printer_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: ShiftAssignment (přiřazení tiskařů ke směnám)
CREATE TABLE `ShiftAssignment` (
    `id`          INTEGER NOT NULL AUTO_INCREMENT,
    `machine`     VARCHAR(191) NOT NULL,
    `date`        DATETIME(3) NOT NULL,
    `shift`       VARCHAR(191) NOT NULL,
    `printerId`   INTEGER NOT NULL,
    `note`        VARCHAR(191) NULL,
    `sortOrder`   INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShiftAssignment_machine_date_shift_printerId_key`(`machine`, `date`, `shift`, `printerId`),
    INDEX `ShiftAssignment_date_machine_idx`(`date`, `machine`),
    INDEX `ShiftAssignment_publishedAt_idx`(`publishedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: ShiftAssignment → Printer
ALTER TABLE `ShiftAssignment`
  ADD CONSTRAINT `ShiftAssignment_printerId_fkey`
  FOREIGN KEY (`printerId`) REFERENCES `Printer`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: odvoď směny z existujících startHour/endHour
-- RANNÍ = 06:00–14:00  → active pokud interval pokrývá (startHour ≤ 6 AND endHour ≥ 14)
-- ODPOL. = 14:00–22:00 → active pokud (startHour ≤ 14 AND endHour ≥ 22)
-- NOČNÍ = 22:00–06:00  → active pokud (startHour ≤ 22 AND endHour ≥ 24) OR (startHour = 0 AND endHour ≥ 6)
UPDATE `MachineWorkHoursTemplateDay`
SET
  `morningOn`   = (`startHour` <= 6  AND `endHour` >= 14),
  `afternoonOn` = (`startHour` <= 14 AND `endHour` >= 22),
  `nightOn`     = ((`startHour` <= 22 AND `endHour` >= 24)
                   OR (`startHour` = 0 AND `endHour` >= 6));
