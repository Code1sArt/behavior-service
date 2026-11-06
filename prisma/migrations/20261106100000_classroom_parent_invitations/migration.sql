CREATE TABLE `ParentClassroomInvitation` (
  `id` VARCHAR(191) NOT NULL,
  `classroomId` INTEGER NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `issuedBy` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ParentClassroomInvitation_classroomId_key` (`classroomId`),
  UNIQUE INDEX `ParentClassroomInvitation_tokenHash_key` (`tokenHash`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ParentClassroomInvitation_classroomId_fkey`
    FOREIGN KEY (`classroomId`) REFERENCES `Classroom`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
