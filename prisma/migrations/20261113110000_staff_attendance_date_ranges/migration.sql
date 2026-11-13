-- Preserve existing one-day notices while changing the model to date ranges.
ALTER TABLE `StaffAttendanceNotice`
  DROP INDEX `StaffAttendanceNotice_teacherId_date_key`,
  DROP INDEX `StaffAttendanceNotice_date_type_idx`,
  CHANGE COLUMN `date` `startDate` DATE NOT NULL,
  ADD COLUMN `endDate` DATE NULL AFTER `startDate`;

UPDATE `StaffAttendanceNotice`
SET `endDate` = `startDate`
WHERE `endDate` IS NULL;

ALTER TABLE `StaffAttendanceNotice`
  MODIFY `endDate` DATE NOT NULL,
  ADD INDEX `StaffAttendanceNotice_startDate_endDate_type_idx` (`startDate`, `endDate`, `type`),
  ADD INDEX `StaffAttendanceNotice_teacherId_startDate_endDate_idx` (`teacherId`, `startDate`, `endDate`);
