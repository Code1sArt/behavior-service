-- CreateTable
CREATE TABLE `NotificationDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `token` TEXT NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `sessionExpiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotificationDevice_tokenHash_key`(`tokenHash`),
    INDEX `NotificationDevice_userId_sessionExpiresAt_idx`(`userId`, `sessionExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceRevision` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseUntil` DATETIME(3) NULL,
    `claimId` VARCHAR(191) NULL,
    `lastError` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PushDelivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `PushDelivery_status_leaseUntil_idx`(`status`, `leaseUntil`),
    UNIQUE INDEX `PushDelivery_eventId_deviceId_key`(`eventId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificationDevice` ADD CONSTRAINT `NotificationDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushDelivery` ADD CONSTRAINT `PushDelivery_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `NotificationDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
