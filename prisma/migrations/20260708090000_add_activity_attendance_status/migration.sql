-- Expand AttendanceRecord.status to support students marked as joining an activity.
-- Existing enum values are kept unchanged so current attendance records remain intact.
ALTER TABLE `AttendanceRecord`
  MODIFY `status` ENUM('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'ACTIVITY') NOT NULL;
