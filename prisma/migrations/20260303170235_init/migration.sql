-- CreateTable
CREATE TABLE "Block" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderNumber" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ZAKAZKA',
    "description" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "deadlineData" DATETIME,
    "deadlineMaterial" DATETIME,
    "deadlineExpedice" DATETIME,
    "deadlineDataOk" BOOLEAN NOT NULL DEFAULT false,
    "deadlineMaterialOk" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceType" TEXT NOT NULL DEFAULT 'NONE',
    "recurrenceParentId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Block_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "Block" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
