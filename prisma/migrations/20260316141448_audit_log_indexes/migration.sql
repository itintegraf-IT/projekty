-- CreateIndex
CREATE INDEX `AuditLog_blockId_createdAt_idx` ON `AuditLog`(`blockId`, `createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_createdAt_idx` ON `AuditLog`(`createdAt`);
