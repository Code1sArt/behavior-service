-- Existing notices predate the approval workflow and remain effective.
ALTER TABLE `StaffAttendanceNotice`
  ADD COLUMN `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING' AFTER `type`,
  ADD COLUMN `reviewerId` VARCHAR(191) NULL AFTER `teacherId`,
  ADD COLUMN `reviewNote` VARCHAR(1000) NULL AFTER `reviewerId`,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL AFTER `reviewNote`;

UPDATE `StaffAttendanceNotice`
SET `status` = 'APPROVED';

ALTER TABLE `StaffAttendanceNotice`
  ADD INDEX `StaffAttendanceNotice_status_startDate_idx` (`status`, `startDate`),
  ADD INDEX `StaffAttendanceNotice_reviewerId_idx` (`reviewerId`),
  ADD CONSTRAINT `StaffAttendanceNotice_reviewerId_fkey`
    FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
