CREATE TABLE `ParentLinkInvitation` (
 `id` VARCHAR(191) NOT NULL,
 `tokenHash` CHAR(64) NOT NULL,
 `studentId` VARCHAR(191) NOT NULL,
 `parentCitizenId` VARCHAR(191) NOT NULL,
 `issuedBy` VARCHAR(191) NOT NULL,
 `expiresAt` DATETIME(3) NOT NULL,
 `usedAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE INDEX `ParentLinkInvitation_tokenHash_key` (`tokenHash`),
 INDEX `ParentLinkInvitation_studentId_expiresAt_idx` (`studentId`, `expiresAt`),
 PRIMARY KEY (`id`),
 CONSTRAINT `ParentLinkInvitation_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
