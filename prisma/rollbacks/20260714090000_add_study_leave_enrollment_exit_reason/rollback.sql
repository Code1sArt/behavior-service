-- Guarded rollback for 20260714090000_add_study_leave_enrollment_exit_reason.
-- Run only after reverting the application and only after taking a verified backup.
-- This intentionally refuses to continue when the new workflow has written data.

DELIMITER $$
CREATE PROCEDURE `guard_enrollment_change_rollback`()
BEGIN
    IF (SELECT COUNT(*) FROM `EnrollmentChangeBatch`) > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Rollback blocked: EnrollmentChangeBatch contains audit data';
    END IF;
    IF (SELECT COUNT(*) FROM `StudentEnrollment` WHERE `exitReason` = 'STUDY_LEAVE') > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Rollback blocked: STUDY_LEAVE enrollment data exists';
    END IF;
    IF EXISTS (
        SELECT 1 FROM `PromotionBatch`
        GROUP BY `type`, `sourceTermId`, `targetTermId`
        HAVING COUNT(*) > 1
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Rollback blocked: partial promotion batches would violate the old unique key';
    END IF;
END$$
DELIMITER ;

CALL `guard_enrollment_change_rollback`();
DROP PROCEDURE `guard_enrollment_change_rollback`;

DROP TABLE `EnrollmentChangeItem`;
DROP TABLE `EnrollmentChangeBatch`;

CREATE UNIQUE INDEX `PromotionBatch_type_sourceTermId_targetTermId_key`
    ON `PromotionBatch`(`type`, `sourceTermId`, `targetTermId`);

ALTER TABLE `StudentEnrollment`
    MODIFY `exitReason` ENUM('TERM_COMPLETED', 'PROMOTED', 'REPEATED', 'TRANSFERRED', 'GRADUATED') NULL;
