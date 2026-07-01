-- AlterTable
ALTER TABLE `PromotionBatch` ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `PromotionBatch_idempotencyKey_key` ON `PromotionBatch`(`idempotencyKey`);

-- CreateIndex
CREATE UNIQUE INDEX `PromotionBatch_type_sourceTermId_targetTermId_key` ON `PromotionBatch`(`type`, `sourceTermId`, `targetTermId`);
