-- AlterTable: make date fields nullable
ALTER TABLE `Reservation` MODIFY COLUMN `requestedExpeditionDate` DATETIME(3) NULL;
ALTER TABLE `Reservation` MODIFY COLUMN `requestedDataDate` DATETIME(3) NULL;

-- AlterTable: add new workflow fields
ALTER TABLE `Reservation`
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `confirmedByUserId` INT NULL,
  ADD COLUMN `confirmedByUsername` VARCHAR(191) NULL,
  ADD COLUMN `counterProposedExpeditionDate` DATETIME(3) NULL,
  ADD COLUMN `counterProposedDataDate` DATETIME(3) NULL,
  ADD COLUMN `counterProposedReason` TEXT NULL,
  ADD COLUMN `counterProposedAt` DATETIME(3) NULL,
  ADD COLUMN `counterProposedByUserId` INT NULL,
  ADD COLUMN `counterProposedByUsername` VARCHAR(191) NULL,
  ADD COLUMN `withdrawnAt` DATETIME(3) NULL,
  ADD COLUMN `withdrawnReason` VARCHAR(191) NULL;
