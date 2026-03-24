-- =============================================================================
-- Integraf Výrobní plán — MySQL konfigurační schema
-- =============================================================================
-- Použití:
--   mysql -u root -pmysql < prisma/mysql-schema.sql
--   mysql -u root -pmysql IGvyroba < prisma/mysql-schema.sql
--
-- Nebo v MySQL klientu:
--   SOURCE /cesta/k/PlanovaniVyroby/prisma/mysql-schema.sql
-- =============================================================================

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- Databáze IGvyroba
CREATE DATABASE IF NOT EXISTS IGvyroba CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE IGvyroba;

-- -----------------------------------------------------------------------------
-- CodebookOption — číselníky (DATA, MATERIAL, BARVY, LAK)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `CodebookOption` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(32) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `shortCode` VARCHAR(32) NULL,
  `isWarning` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  INDEX `idx_codebook_category` (`category`, `sortOrder`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- User — uživatelé
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `User` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'VIEWER',
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- CompanyDay — firemní dny / odstávky
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `CompanyDay` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `startDate` DATE NOT NULL,
  `endDate` DATE NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_companyday_dates` (`startDate`, `endDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Block — zakázky / rezervace / údržba
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `Block` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `orderNumber` VARCHAR(64) NOT NULL,
  `machine` VARCHAR(16) NOT NULL,
  `startTime` DATETIME NOT NULL,
  `endTime` DATETIME NOT NULL,
  `type` VARCHAR(32) NOT NULL DEFAULT 'ZAKAZKA',
  `description` TEXT NULL,
  `locked` TINYINT(1) NOT NULL DEFAULT 0,
  `deadlineExpedice` DATETIME NULL,
  `dataStatusId` INT UNSIGNED NULL,
  `dataStatusLabel` VARCHAR(255) NULL,
  `dataRequiredDate` DATETIME NULL,
  `dataOk` TINYINT(1) NOT NULL DEFAULT 0,
  `materialStatusId` INT UNSIGNED NULL,
  `materialStatusLabel` VARCHAR(255) NULL,
  `materialRequiredDate` DATETIME NULL,
  `materialOk` TINYINT(1) NOT NULL DEFAULT 0,
  `barvyStatusId` INT UNSIGNED NULL,
  `barvyStatusLabel` VARCHAR(255) NULL,
  `lakStatusId` INT UNSIGNED NULL,
  `lakStatusLabel` VARCHAR(255) NULL,
  `specifikace` TEXT NULL,
  `recurrenceType` VARCHAR(32) NOT NULL DEFAULT 'NONE',
  `recurrenceParentId` INT UNSIGNED NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_block_machine_start` (`machine`, `startTime`),
  INDEX `idx_block_order` (`orderNumber`),
  INDEX `idx_block_recurrence` (`recurrenceParentId`),
  CONSTRAINT `fk_block_recurrence` FOREIGN KEY (`recurrenceParentId`) REFERENCES `Block` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- AuditLog — audit změn (Etapa 10)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `AuditLog` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `blockId` INT UNSIGNED NOT NULL,
  `orderNumber` VARCHAR(64) NOT NULL,
  `userId` INT UNSIGNED NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `field` VARCHAR(64) NULL,
  `oldValue` VARCHAR(512) NULL,
  `newValue` VARCHAR(512) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_audit_block` (`blockId`),
  INDEX `idx_audit_created` (`createdAt` DESC),
  INDEX `idx_audit_user` (`userId`, `createdAt`),
  INDEX `idx_audit_order` (`orderNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Konec schema
-- =============================================================================
