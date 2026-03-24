-- CreateTable
CREATE TABLE `MachineScheduleException` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machine` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `startHour` INTEGER NOT NULL,
    `endHour` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `label` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MachineScheduleException_date_idx`(`date`),
    UNIQUE INDEX `MachineScheduleException_machine_date_key`(`machine`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
