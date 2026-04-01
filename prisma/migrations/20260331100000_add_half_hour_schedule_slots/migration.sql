ALTER TABLE `MachineWorkHoursTemplateDay`
  ADD COLUMN `startSlot` INTEGER NULL,
  ADD COLUMN `endSlot` INTEGER NULL;

UPDATE `MachineWorkHoursTemplateDay`
SET
  `startSlot` = `startHour` * 2,
  `endSlot` = `endHour` * 2
WHERE `startSlot` IS NULL OR `endSlot` IS NULL;

ALTER TABLE `MachineScheduleException`
  ADD COLUMN `startSlot` INTEGER NULL,
  ADD COLUMN `endSlot` INTEGER NULL;

UPDATE `MachineScheduleException`
SET
  `startSlot` = `startHour` * 2,
  `endSlot` = `endHour` * 2
WHERE `startSlot` IS NULL OR `endSlot` IS NULL;
