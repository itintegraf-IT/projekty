-- CreateTable: MachineWeekShifts
-- Per-týdenní definice, které směny daný stroj v daném týdnu/dni jede.
-- Nahrazuje kombinaci MachineWorkHoursTemplate + MachineWorkHoursTemplateDay + MachineScheduleException.
CREATE TABLE `MachineWeekShifts` (
    `id`          INTEGER NOT NULL AUTO_INCREMENT,
    `machine`     VARCHAR(20) NOT NULL,
    `weekStart`   DATE NOT NULL,
    `dayOfWeek`   INTEGER NOT NULL,
    `isActive`    BOOLEAN NOT NULL DEFAULT true,
    `morningOn`   BOOLEAN NOT NULL DEFAULT false,
    `afternoonOn` BOOLEAN NOT NULL DEFAULT false,
    `nightOn`     BOOLEAN NOT NULL DEFAULT false,
    `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MachineWeekShifts_machine_weekStart_dayOfWeek_key`(`machine`, `weekStart`, `dayOfWeek`),
    INDEX `MachineWeekShifts_machine_weekStart_idx`(`machine`, `weekStart`),
    INDEX `MachineWeekShifts_weekStart_idx`(`weekStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
