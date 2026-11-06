-- Allow schools to issue student-specific codes before a parent registers.
-- Existing codes retain their original parent binding.
ALTER TABLE `ParentLinkInvitation`
  MODIFY `parentCitizenId` VARCHAR(191) NULL;
