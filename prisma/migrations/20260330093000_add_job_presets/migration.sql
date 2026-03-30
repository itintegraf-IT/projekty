ALTER TABLE `Block`
    ADD COLUMN `jobPresetId` INTEGER NULL,
    ADD COLUMN `jobPresetLabel` VARCHAR(191) NULL;

CREATE TABLE `JobPreset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `isSystemPreset` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `appliesToZakazka` BOOLEAN NOT NULL DEFAULT true,
    `appliesToRezervace` BOOLEAN NOT NULL DEFAULT true,
    `machineConstraint` VARCHAR(191) NULL,
    `blockVariant` VARCHAR(191) NULL,
    `specifikace` TEXT NULL,
    `dataStatusId` INTEGER NULL,
    `dataRequiredDateOffsetDays` INTEGER NULL,
    `materialStatusId` INTEGER NULL,
    `materialRequiredDateOffsetDays` INTEGER NULL,
    `materialInStock` BOOLEAN NULL,
    `pantoneRequiredDateOffsetDays` INTEGER NULL,
    `barvyStatusId` INTEGER NULL,
    `lakStatusId` INTEGER NULL,
    `deadlineExpediceOffsetDays` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Block_jobPresetId_idx` ON `Block`(`jobPresetId`);
CREATE INDEX `JobPreset_isActive_sortOrder_idx` ON `JobPreset`(`isActive`, `sortOrder`);

INSERT INTO `JobPreset` (
    `name`,
    `isSystemPreset`,
    `isActive`,
    `sortOrder`,
    `appliesToZakazka`,
    `appliesToRezervace`,
    `machineConstraint`
)
SELECT * FROM (
    SELECT 'XL 105', true, true, 0, true, true, 'XL_105'
) AS tmp
WHERE NOT EXISTS (
    SELECT 1 FROM `JobPreset` WHERE `isSystemPreset` = true AND `name` = 'XL 105'
);

INSERT INTO `JobPreset` (
    `name`,
    `isSystemPreset`,
    `isActive`,
    `sortOrder`,
    `appliesToZakazka`,
    `appliesToRezervace`,
    `machineConstraint`
)
SELECT * FROM (
    SELECT 'XL 106 LED', true, true, 1, true, true, 'XL_106'
) AS tmp
WHERE NOT EXISTS (
    SELECT 1 FROM `JobPreset` WHERE `isSystemPreset` = true AND `name` = 'XL 106 LED'
);

INSERT INTO `JobPreset` (
    `name`,
    `isSystemPreset`,
    `isActive`,
    `sortOrder`,
    `appliesToZakazka`,
    `appliesToRezervace`,
    `machineConstraint`
)
SELECT * FROM (
    SELECT 'XL 106 IML', true, true, 2, true, true, 'XL_106'
) AS tmp
WHERE NOT EXISTS (
    SELECT 1 FROM `JobPreset` WHERE `isSystemPreset` = true AND `name` = 'XL 106 IML'
);
