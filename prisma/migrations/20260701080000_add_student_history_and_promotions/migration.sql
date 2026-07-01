-- AlterTable
ALTER TABLE `AttendanceRecord` ADD COLUMN `classroomId` INTEGER NULL;

-- AlterTable
ALTER TABLE `BehaviorRecord` ADD COLUMN `classroomId` INTEGER NULL,
    ADD COLUMN `pointDelta` INTEGER NULL,
    ADD COLUMN `termId` INTEGER NULL;

-- CreateTable
CREATE TABLE `StudentPointAccount` (
    `studentId` VARCHAR(191) NOT NULL,
    `initialPoints` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`studentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentEnrollment` (
    `id` VARCHAR(191) NOT NULL,
    `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
    `exitReason` ENUM('TERM_COMPLETED', 'PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED') NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `classroomId` INTEGER NOT NULL,
    `termId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StudentEnrollment_studentId_status_idx`(`studentId`, `status`),
    INDEX `StudentEnrollment_classroomId_idx`(`classroomId`),
    INDEX `StudentEnrollment_termId_idx`(`termId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionBatch` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('TERM_ROLLOVER', 'ANNUAL_PROMOTION') NOT NULL,
    `status` ENUM('DRAFT', 'APPLIED', 'CANCELLED', 'FAILED') NOT NULL DEFAULT 'DRAFT',
    `appliedAt` DATETIME(3) NULL,
    `sourceTermId` INTEGER NOT NULL,
    `targetTermId` INTEGER NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `appliedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PromotionBatch_sourceTermId_idx`(`sourceTermId`),
    INDEX `PromotionBatch_targetTermId_idx`(`targetTermId`),
    INDEX `PromotionBatch_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionItem` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('MOVE', 'REPEAT', 'GRADUATE', 'TRANSFER_OUT', 'SKIP') NOT NULL DEFAULT 'MOVE',
    `note` VARCHAR(191) NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `sourceClassroomId` INTEGER NOT NULL,
    `targetClassroomId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PromotionItem_studentId_idx`(`studentId`),
    INDEX `PromotionItem_sourceClassroomId_idx`(`sourceClassroomId`),
    INDEX `PromotionItem_targetClassroomId_idx`(`targetClassroomId`),
    UNIQUE INDEX `PromotionItem_batchId_studentId_key`(`batchId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `AttendanceRecord_termId_classroomId_date_idx` ON `AttendanceRecord`(`termId`, `classroomId`, `date`);

-- CreateIndex
CREATE INDEX `BehaviorRecord_termId_classroomId_createdAt_idx` ON `BehaviorRecord`(`termId`, `classroomId`, `createdAt`);

-- CreateIndex
CREATE INDEX `BehaviorRecord_studentId_createdAt_idx` ON `BehaviorRecord`(`studentId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `StudentPointAccount` ADD CONSTRAINT `StudentPointAccount_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentEnrollment` ADD CONSTRAINT `StudentEnrollment_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentEnrollment` ADD CONSTRAINT `StudentEnrollment_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentEnrollment` ADD CONSTRAINT `StudentEnrollment_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionBatch` ADD CONSTRAINT `PromotionBatch_sourceTermId_fkey` FOREIGN KEY (`sourceTermId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionBatch` ADD CONSTRAINT `PromotionBatch_targetTermId_fkey` FOREIGN KEY (`targetTermId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionBatch` ADD CONSTRAINT `PromotionBatch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionBatch` ADD CONSTRAINT `PromotionBatch_appliedById_fkey` FOREIGN KEY (`appliedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `PromotionBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_sourceClassroomId_fkey` FOREIGN KEY (`sourceClassroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PromotionItem` ADD CONSTRAINT `PromotionItem_targetClassroomId_fkey` FOREIGN KEY (`targetClassroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecord` ADD CONSTRAINT `BehaviorRecord_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecord` ADD CONSTRAINT `BehaviorRecord_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
