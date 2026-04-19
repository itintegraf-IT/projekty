-- AlterTable: MachineWeekShifts — add 6 nullable override columns for per-shift hour overrides
-- null = use default from SHIFT_HOURS (MORNING 6-14, AFTERNOON 14-22, NIGHT 22-6)
-- Values in minutes from midnight, snapped to 30 min.
ALTER TABLE `MachineWeekShifts` ADD COLUMN `morningStartMin`   INTEGER NULL;
ALTER TABLE `MachineWeekShifts` ADD COLUMN `morningEndMin`     INTEGER NULL;
ALTER TABLE `MachineWeekShifts` ADD COLUMN `afternoonStartMin` INTEGER NULL;
ALTER TABLE `MachineWeekShifts` ADD COLUMN `afternoonEndMin`   INTEGER NULL;
ALTER TABLE `MachineWeekShifts` ADD COLUMN `nightStartMin`     INTEGER NULL;
ALTER TABLE `MachineWeekShifts` ADD COLUMN `nightEndMin`       INTEGER NULL;
