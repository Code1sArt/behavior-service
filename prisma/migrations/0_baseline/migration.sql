-- Baseline migration for the schema that existed before Prisma Migrate was adopted.
-- Existing databases must mark this migration as applied; do not execute it there.

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `citizenId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `role` ENUM('STUDENT', 'TEACHER', 'AFFAIRS', 'ADMIN', 'PARENT') NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `lineUserId` VARCHAR(191) NULL,
    `classroomId` INTEGER NULL,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_citizenId_key`(`citizenId`),
    UNIQUE INDEX `User_lineUserId_key`(`lineUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemConfig` (
    `key` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcademicTerm` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `term` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `AcademicTerm_year_term_key`(`year`, `term`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AcademicHoliday` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `academicTermId` INTEGER NOT NULL,

    INDEX `AcademicHoliday_date_idx`(`date`),
    UNIQUE INDEX `AcademicHoliday_academicTermId_date_key`(`academicTermId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Classroom` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `startingPoints` INTEGER NOT NULL DEFAULT 100,
    `failingThreshold` INTEGER NOT NULL,
    `certificateThreshold` INTEGER NOT NULL,
    `shieldThreshold` INTEGER NOT NULL,
    `termId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PointCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('ADD', 'DEDUCT') NOT NULL,
    `defaultPoints` INTEGER NOT NULL,
    `allowedForTeacher` BOOLEAN NOT NULL DEFAULT false,
    `allowedForAffairs` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceRecord` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('ASSEMBLY', 'AREA') NOT NULL,
    `status` ENUM('PRESENT', 'LATE', 'ABSENT', 'LEAVE') NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `studentId` VARCHAR(191) NOT NULL,
    `recorderId` VARCHAR(191) NOT NULL,
    `termId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BehaviorRecord` (
    `id` VARCHAR(191) NOT NULL,
    `points` INTEGER NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `categoryId` INTEGER NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `recorderId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ClassroomAdvisors` (
    `A` INTEGER NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_ClassroomAdvisors_AB_unique`(`A`, `B`),
    INDEX `_ClassroomAdvisors_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_classroomId_fkey` FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AcademicHoliday` ADD CONSTRAINT `AcademicHoliday_academicTermId_fkey` FOREIGN KEY (`academicTermId`) REFERENCES `AcademicTerm`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Classroom` ADD CONSTRAINT `Classroom_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_recorderId_fkey` FOREIGN KEY (`recorderId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceRecord` ADD CONSTRAINT `AttendanceRecord_termId_fkey` FOREIGN KEY (`termId`) REFERENCES `AcademicTerm`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecord` ADD CONSTRAINT `BehaviorRecord_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `PointCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecord` ADD CONSTRAINT `BehaviorRecord_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BehaviorRecord` ADD CONSTRAINT `BehaviorRecord_recorderId_fkey` FOREIGN KEY (`recorderId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ClassroomAdvisors` ADD CONSTRAINT `_ClassroomAdvisors_A_fkey` FOREIGN KEY (`A`) REFERENCES `Classroom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_ClassroomAdvisors` ADD CONSTRAINT `_ClassroomAdvisors_B_fkey` FOREIGN KEY (`B`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
