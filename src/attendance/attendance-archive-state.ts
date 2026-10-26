import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const attendanceTermStateKey = (termId: number) =>
  `ATTENDANCE_TERM_STATE_${termId}`;

// Updating the same row serializes attendance writes and archival for a term.
// Keep this small marker after deleting history to prevent duplicate deductions.
export async function lockAttendanceTerm(
  tx: Prisma.TransactionClient,
  termId: number,
) {
  const key = attendanceTermStateKey(termId);
  const state = await tx.systemConfig.upsert({
    where: { key },
    create: { key, value: 'OPEN' },
    update: { key },
  });
  if (state.value !== 'OPEN') {
    throw new BadRequestException(
      'ภาคเรียนนี้เก็บถาวรและล้างประวัติแล้ว ไม่สามารถบันทึกเช็คชื่อซ้ำได้ กรุณาเปิดไฟล์ย้อนหลัง',
    );
  }
}
