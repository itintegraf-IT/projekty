-- CreateTable
CREATE TABLE `MachineWorkHours` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machine` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startHour` INTEGER NOT NULL,
    `endHour` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MachineWorkHours_machine_idx`(`machine`),
    UNIQUE INDEX `MachineWorkHours_machine_dayOfWeek_key`(`machine`, `dayOfWeek`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
