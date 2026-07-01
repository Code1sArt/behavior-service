import { Role } from '@prisma/client';
import {
  applyStudentHistoryBackfill,
  BACKFILL_CONFIRMATION,
  buildStudentHistoryBackfillPlan,
} from '../src/data-migrations/student-history-backfill';
import { PrismaService } from '../src/prisma/prisma.service';

const argumentsSet = new Set(process.argv.slice(2));
const apply = argumentsSet.has('--apply');
const confirmation = process.argv
  .find((argument) => argument.startsWith('--confirm='))
  ?.slice('--confirm='.length);

async function main() {
  if (apply && confirmation !== BACKFILL_CONFIRMATION) {
    throw new Error(
      `โหมดเขียนต้องระบุ --confirm=${BACKFILL_CONFIRMATION} เพิ่มเติม`,
    );
  }

  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const [
      students,
      terms,
      attendanceRecords,
      behaviorRecords,
      pointAccounts,
      enrollments,
    ] = await Promise.all([
      prisma.user.findMany({
        where: { role: Role.STUDENT },
        select: {
          id: true,
          createdAt: true,
          classroom: {
            select: {
              id: true,
              startingPoints: true,
              termId: true,
              term: {
                select: {
                  id: true,
                  startDate: true,
                  endDate: true,
                  isActive: true,
                },
              },
            },
          },
        },
      }),
      prisma.academicTerm.findMany({
        select: {
          id: true,
          startDate: true,
          endDate: true,
          isActive: true,
        },
      }),
      prisma.attendanceRecord.findMany({
        select: {
          id: true,
          termId: true,
          classroomId: true,
          student: {
            select: {
              id: true,
              classroom: { select: { id: true, termId: true } },
            },
          },
        },
      }),
      prisma.behaviorRecord.findMany({
        select: {
          id: true,
          points: true,
          pointDelta: true,
          classroomId: true,
          termId: true,
          createdAt: true,
          category: { select: { type: true } },
          student: {
            select: {
              id: true,
              classroom: { select: { id: true, termId: true } },
            },
          },
        },
      }),
      prisma.studentPointAccount.findMany({
        select: { studentId: true, initialPoints: true },
      }),
      prisma.studentEnrollment.findMany({
        select: {
          studentId: true,
          classroomId: true,
          termId: true,
          status: true,
        },
      }),
    ]);

    const plan = buildStudentHistoryBackfillPlan({
      students,
      terms,
      attendanceRecords,
      behaviorRecords,
      pointAccounts,
      enrollments,
    });

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'APPLY' : 'DRY_RUN',
          summary: plan.summary,
          issues: plan.issues,
        },
        null,
        2,
      ),
    );

    if (!apply) {
      console.log(
        `Dry-run เท่านั้น: เมื่อไม่มี blocking issue ให้รันใหม่ด้วย --apply --confirm=${BACKFILL_CONFIRMATION}`,
      );
      return;
    }

    await applyStudentHistoryBackfill(prisma, plan);
    console.log('Backfill completed successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Backfill failed: ${message}`);
  process.exitCode = 1;
});
