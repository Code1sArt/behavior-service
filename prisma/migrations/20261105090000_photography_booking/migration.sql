-- CreateTable
CREATE TABLE `PhotographyMutex` (
    `id` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyManager` (
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Photographer` (
    `userId` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyDepartment` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `PhotographyDepartment_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyEquipment` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `PhotographyEquipment_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyBooking` (
    `id` VARCHAR(191) NOT NULL,
    `kind` ENUM('PHOTOGRAPHERS', 'EQUIPMENT') NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `activityName` VARCHAR(191) NOT NULL,
    `location` VARCHAR(500) NOT NULL,
    `photographerCount` INTEGER NOT NULL DEFAULT 0,
    `hasLunch` BOOLEAN NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `reviewNote` VARCHAR(1000) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PhotographyBooking_requesterId_createdAt_idx`(`requesterId`, `createdAt`),
    INDEX `PhotographyBooking_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyBookingSlot` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,

    INDEX `PhotographyBookingSlot_bookingId_idx`(`bookingId`),
    INDEX `PhotographyBookingSlot_startsAt_endsAt_idx`(`startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyAssignment` (
    `bookingId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,

    INDEX `PhotographyAssignment_studentId_idx`(`studentId`),
    PRIMARY KEY (`bookingId`, `studentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyBookingEquipment` (
    `bookingId` VARCHAR(191) NOT NULL,
    `equipmentId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,

    INDEX `PhotographyBookingEquipment_equipmentId_idx`(`equipmentId`),
    PRIMARY KEY (`bookingId`, `equipmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PhotographyLineDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseUntil` DATETIME(3) NULL,
    `claimId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PhotographyLineDelivery_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `PhotographyLineDelivery_status_leaseUntil_idx`(`status`, `leaseUntil`),
    UNIQUE INDEX `PhotographyLineDelivery_eventId_userId_key`(`eventId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PhotographyManager` ADD CONSTRAINT `PhotographyManager_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Photographer` ADD CONSTRAINT `Photographer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyBooking` ADD CONSTRAINT `PhotographyBooking_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyBooking` ADD CONSTRAINT `PhotographyBooking_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `PhotographyDepartment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyBooking` ADD CONSTRAINT `PhotographyBooking_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyBookingSlot` ADD CONSTRAINT `PhotographyBookingSlot_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `PhotographyBooking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyAssignment` ADD CONSTRAINT `PhotographyAssignment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `PhotographyBooking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyAssignment` ADD CONSTRAINT `PhotographyAssignment_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyBookingEquipment` ADD CONSTRAINT `PhotographyBookingEquipment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `PhotographyBooking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyBookingEquipment` ADD CONSTRAINT `PhotographyBookingEquipment_equipmentId_fkey` FOREIGN KEY (`equipmentId`) REFERENCES `PhotographyEquipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PhotographyLineDelivery` ADD CONSTRAINT `PhotographyLineDelivery_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Global booking/roster/inventory lock.
INSERT INTO `PhotographyMutex` (`id`, `revision`) VALUES (1, 0);

-- Editable starter options; existing users and application tables are not changed.
INSERT INTO `PhotographyDepartment` (`id`, `name`, `active`) VALUES
('photo-dept-thai', 'กลุ่มสาระการเรียนรู้ภาษาไทย', true),
('photo-dept-math', 'กลุ่มสาระการเรียนรู้คณิตศาสตร์', true),
('photo-dept-science', 'กลุ่มสาระการเรียนรู้วิทยาศาสตร์และเทคโนโลยี', true),
('photo-dept-social', 'กลุ่มสาระการเรียนรู้สังคมศึกษา ศาสนา และวัฒนธรรม', true),
('photo-dept-health', 'กลุ่มสาระการเรียนรู้สุขศึกษาและพลศึกษา', true),
('photo-dept-art', 'กลุ่มสาระการเรียนรู้ศิลปะ', true),
('photo-dept-career', 'กลุ่มสาระการเรียนรู้การงานอาชีพ', true),
('photo-dept-language', 'กลุ่มสาระการเรียนรู้ภาษาต่างประเทศ', true),
('photo-dept-academic', 'กลุ่มบริหารวิชาการ', true),
('photo-dept-budget', 'กลุ่มบริหารงบประมาณ', true),
('photo-dept-personnel', 'กลุ่มบริหารงานบุคคล', true),
('photo-dept-general', 'กลุ่มบริหารทั่วไป', true),
('photo-dept-student', 'กลุ่มบริหารกิจการนักเรียน', true);
