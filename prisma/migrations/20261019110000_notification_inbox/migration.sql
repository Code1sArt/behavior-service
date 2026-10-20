CREATE TABLE `NotificationInbox` (
 `id` VARCHAR(191) NOT NULL,
 `userId` VARCHAR(191) NOT NULL,
 `eventId` VARCHAR(191) NOT NULL,
 `kind` VARCHAR(16) NOT NULL,
 `readAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`),
 UNIQUE INDEX `NotificationInbox_userId_eventId_key` (`userId`, `eventId`),
 INDEX `NotificationInbox_userId_readAt_createdAt_idx` (`userId`, `readAt`, `createdAt`),
 INDEX `NotificationInbox_userId_createdAt_id_idx` (`userId`, `createdAt`, `id`),
 CONSTRAINT `NotificationInbox_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
