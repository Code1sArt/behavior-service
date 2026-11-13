-- Add the executive role everywhere Role is persisted.
ALTER TABLE `User`
  MODIFY `role` ENUM('STUDENT', 'TEACHER', 'AFFAIRS', 'ADMIN', 'EXECUTIVE', 'PARENT') NOT NULL;

ALTER TABLE `StaffEmailOtp`
  MODIFY `role` ENUM('STUDENT', 'TEACHER', 'AFFAIRS', 'ADMIN', 'EXECUTIVE', 'PARENT') NOT NULL;

-- One teacher can submit one attendance notice per calendar day.
CREATE TABLE `StaffAttendanceNotice` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('PERSONAL_LEAVE', 'SICK_LEAVE', 'LATE_ARRIVAL') NOT NULL,
    `date` DATE NOT NULL,
    `arrivalTime` VARCHAR(5) NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `teacherId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StaffAttendanceNotice_date_type_idx`(`date`, `type`),
    UNIQUE INDEX `StaffAttendanceNotice_teacherId_date_key`(`teacherId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StaffAttendanceNotice`
  ADD CONSTRAINT `StaffAttendanceNotice_teacherId_fkey`
  FOREIGN KEY (`teacherId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
