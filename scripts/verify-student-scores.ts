import { Role } from '@prisma/client';
import { verifyStudentScores } from '../src/data-migrations/student-score-verification';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const students = await prisma.user.findMany({
      where: { role: Role.STUDENT },
      select: {
        id: true,
        classroom: {
          select: {
            startingPoints: true,
          },
        },
        pointAccount: {
          select: {
            initialPoints: true,
          },
        },
        behaviorLogs: {
          select: {
            id: true,
            points: true,
            pointDelta: true,
            category: {
              select: {
                type: true,
              },
            },
          },
        },
      },
    });

    const report = verifyStudentScores(students);
    console.log(JSON.stringify(report, null, 2));

    if (report.summary.blockingIssues > 0) {
      throw new Error(
        `ตรวจพบคะแนนหรือข้อมูลไม่ตรงกัน ${report.summary.blockingIssues} รายการ`,
      );
    }

    console.log(
      `Score verification passed for ${report.summary.matchedStudents} students.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Score verification failed: ${message}`);
  process.exitCode = 1;
});
