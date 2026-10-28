-- AlterTable
ALTER TABLE `User` ADD COLUMN `email` VARCHAR(254) NULL,
    ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `StaffEmailOtp` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `role` ENUM('STUDENT', 'TEACHER', 'AFFAIRS', 'ADMIN', 'PARENT') NOT NULL,
    `purpose` VARCHAR(16) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `credentialHash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `sentAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StaffEmailOtp_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `StaffEmailOtp_createdAt_idx`(`createdAt`),
    INDEX `StaffEmailOtp_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailOtpBucket` (
    `key` VARCHAR(160) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `EmailOtpBucket_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_email_key` ON `User`(`email`);

-- AddForeignKey
ALTER TABLE `StaffEmailOtp` ADD CONSTRAINT `StaffEmailOtp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
