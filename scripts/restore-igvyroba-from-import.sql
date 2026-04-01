-- Kopíruje data z igvyroba_import (naimportovaný igvyroba.sql) do igvyroba.
-- Cílová DB musí odpovídat DATABASE_URL (např. mysql://.../igvyroba).
-- Před spuštěním: vytvořit a naplnit igvyroba_import.

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE igvyroba.notification;
TRUNCATE TABLE igvyroba.reservationattachment;
TRUNCATE TABLE igvyroba.reservation;
TRUNCATE TABLE igvyroba.auditlog;
TRUNCATE TABLE igvyroba.block;
TRUNCATE TABLE igvyroba.codebookoption;
TRUNCATE TABLE igvyroba.companyday;
TRUNCATE TABLE igvyroba.machinescheduleexception;
TRUNCATE TABLE igvyroba.machineworkhourstemplateday;
TRUNCATE TABLE igvyroba.machineworkhourstemplate;
TRUNCATE TABLE igvyroba.machineworkhours;
TRUNCATE TABLE igvyroba.jobpreset;
TRUNCATE TABLE igvyroba.user;

INSERT INTO igvyroba.user (id, username, passwordHash, role, createdAt, assignedMachine)
SELECT id, username, passwordHash, role, createdAt, assignedMachine FROM igvyroba_import.user;

INSERT INTO igvyroba.codebookoption (id, category, label, sortOrder, isActive, shortCode, isWarning, badgeColor)
SELECT id, category, label, sortOrder, isActive, shortCode, isWarning, badgeColor FROM igvyroba_import.codebookoption;

INSERT INTO igvyroba.companyday (id, startDate, endDate, label, createdAt, machine)
SELECT id, startDate, endDate, label, createdAt, machine FROM igvyroba_import.companyday;

INSERT INTO igvyroba.machineworkhours (id, machine, dayOfWeek, startHour, endHour, isActive)
SELECT id, machine, dayOfWeek, startHour, endHour, isActive FROM igvyroba_import.machineworkhours;

INSERT INTO igvyroba.machinescheduleexception (id, machine, date, startHour, endHour, isActive, label, createdAt, startSlot, endSlot)
SELECT id, machine, date, startHour, endHour, isActive, label, createdAt, NULL, NULL FROM igvyroba_import.machinescheduleexception;

INSERT INTO igvyroba.block (
  id, orderNumber, machine, startTime, endTime, type, description, locked, deadlineExpedice,
  dataStatusId, dataStatusLabel, dataRequiredDate, dataOk,
  materialStatusId, materialStatusLabel, materialRequiredDate, materialOk,
  barvyStatusId, barvyStatusLabel, lakStatusId, lakStatusLabel, specifikace,
  recurrenceType, recurrenceParentId,
  createdAt, updatedAt, printCompletedAt, printCompletedByUserId, printCompletedByUsername,
  materialNote, materialNoteByUsername, blockVariant,
  splitGroupId, materialInStock, pantoneOk, pantoneRequiredDate, reservationId, jobPresetId, jobPresetLabel
)
SELECT
  id, orderNumber, machine, startTime, endTime, type, description, locked, deadlineExpedice,
  dataStatusId, dataStatusLabel, dataRequiredDate, dataOk,
  materialStatusId, materialStatusLabel, materialRequiredDate, materialOk,
  barvyStatusId, barvyStatusLabel, lakStatusId, lakStatusLabel, specifikace,
  recurrenceType, recurrenceParentId,
  createdAt, updatedAt, printCompletedAt, printCompletedByUserId, printCompletedByUsername,
  materialNote, materialNoteByUsername, blockVariant,
  NULL, 0, 0, NULL, NULL, NULL, NULL
FROM igvyroba_import.block;

INSERT INTO igvyroba.auditlog (id, blockId, orderNumber, userId, username, action, field, oldValue, newValue, createdAt)
SELECT id, blockId, orderNumber, userId, username, action, field, oldValue, newValue, createdAt FROM igvyroba_import.auditlog;

SET FOREIGN_KEY_CHECKS = 1;

ALTER TABLE igvyroba.block AUTO_INCREMENT = 1000;
ALTER TABLE igvyroba.auditlog AUTO_INCREMENT = 1000;
ALTER TABLE igvyroba.user AUTO_INCREMENT = 100;
ALTER TABLE igvyroba.codebookoption AUTO_INCREMENT = 1000;
ALTER TABLE igvyroba.companyday AUTO_INCREMENT = 100;
ALTER TABLE igvyroba.machineworkhours AUTO_INCREMENT = 100;
ALTER TABLE igvyroba.machinescheduleexception AUTO_INCREMENT = 100;
