-- Drop legacy shift model tables.
-- Data was migrated into MachineWeekShifts by scripts/migrate-to-week-shifts.ts (Sprint A).
-- CompanyDay is preserved (hard global blocks).
-- MachineWorkHours is preserved for bootstrap compat (see CLAUDE.md).

DROP TABLE IF EXISTS `MachineWorkHoursTemplateDay`;
DROP TABLE IF EXISTS `MachineWorkHoursTemplate`;
DROP TABLE IF EXISTS `MachineScheduleException`;
