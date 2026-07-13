-- AlterTable
ALTER TABLE `StudentEnrollment`
    MODIFY `exitReason` ENUM('TERM_COMPLETED', 'PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED', 'STUDY_LEAVE') NULL;

-- Partial promotion runs must be allowed so the remaining classrooms can be
-- processed in later batches. Idempotency is still enforced per request.
DROP INDEX `PromotionBatch_type_sourceTermId_targetTermId_key` ON `PromotionBatch`;

-- CreateTable
CREATE TABLE `EnrollmentChangeBatch` (
    `id` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `termId` INTEGER NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EnrollmentChangeBatch_idempotencyKey_key`(`idempotencyKey`),
    INDEX `EnrollmentChangeBatch_termId_idx`(`termId`),
    INDEX `EnrollmentChangeBatch_createdById_idx`(`createdById`),
    INDEX `EnrollmentChangeBatch_appliedAt_idx`(`appliedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EnrollmentChangeItem` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('TRANSFER_OUT', 'STUDY_LEAVE', 'RETURN_TO_STUDY') NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `sourceEnrollmentId` VARCHAR(191) NULL,
    `targetEnrollmentId` VARCHAR(191) NULL,
    `sourceClassroomId` INTEGER NULL,
    `targetClassroomId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EnrollmentChangeItem_batchId_studentId_key`(`batchId`, `studentId`),
    INDEX `EnrollmentChangeItem_studentId_idx`(`studentId`),
    INDEX `EnrollmentChangeItem_sourceEnrollmentId_idx`(`sourceEnrollmentId`),
    INDEX `EnrollmentChangeItem_targetEnrollmentId_idx`(`targetEnrollmentId`),
    INDEX `EnrollmentChangeItem_sourceClassroomId_idx`(`sourceClassroomId`),
    INDEX `EnrollmentChangeItem_targetClassroomId_idx`(`targetClassroomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EnrollmentChangeBatch` ADD CONSTRAINT `EnrollmentChangeBatch_termId_fkey`
    FOREIGN KEY (`termId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeBatch` ADD CONSTRAINT `EnrollmentChangeBatch_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeItem` ADD CONSTRAINT `EnrollmentChangeItem_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `EnrollmentChangeBatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeItem` ADD CONSTRAINT `EnrollmentChangeItem_studentId_fkey`
    FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeItem` ADD CONSTRAINT `EnrollmentChangeItem_sourceEnrollmentId_fkey`
    FOREIGN KEY (`sourceEnrollmentId`) REFERENCES `StudentEnrollment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeItem` ADD CONSTRAINT `EnrollmentChangeItem_targetEnrollmentId_fkey`
    FOREIGN KEY (`targetEnrollmentId`) REFERENCES `StudentEnrollment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeItem` ADD CONSTRAINT `EnrollmentChangeItem_sourceClassroomId_fkey`
    FOREIGN KEY (`sourceClassroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EnrollmentChangeItem` ADD CONSTRAINT `EnrollmentChangeItem_targetClassroomId_fkey`
    FOREIGN KEY (`targetClassroomId`) REFERENCES `Classroom`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
