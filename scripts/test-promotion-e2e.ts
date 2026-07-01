import { execFileSync } from 'node:child_process';
import {
  EnrollmentExitReason,
  EnrollmentStatus,
  PointType,
  PromotionAction,
  PromotionStatus,
  PromotionType,
  Role,
} from '@prisma/client';
import mariadb, { Connection } from 'mariadb';
import { BACKFILL_CONFIRMATION } from '../src/data-migrations/student-history-backfill';
import { PrismaService } from '../src/prisma/prisma.service';
import { PromotionsService } from '../src/promotions/promotions.service';

const sourceUrl = new URL(process.env.DATABASE_URL as string);
const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (!allowedHosts.has(sourceUrl.hostname)) {
  throw new Error(
    `E2E safety guard: DATABASE_URL must use localhost, received ${sourceUrl.hostname}`,
  );
}

const databaseName = `behavior_e2e_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl.toString());
testUrl.pathname = `/${databaseName}`;

const serverConnectionOptions = {
  host: sourceUrl.hostname,
  port: Number(sourceUrl.port) || 3306,
  user: decodeURIComponent(sourceUrl.username),
  password: decodeURIComponent(sourceUrl.password),
  connectTimeout: 5_000,
};

const runProjectCommand = (command: string, args: string[]) => {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
    },
    stdio: 'inherit',
  });
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}

async function createDatabase(): Promise<Connection> {
  const connection = await mariadb.createConnection(serverConnectionOptions);
  await connection.query(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  return connection;
}

async function seedLegacyData(prisma: PrismaService) {
  const [term1, term2, nextYear] = await Promise.all([
    prisma.academicTerm.create({
      data: {
        term: 1,
        year: 2569,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-10-31'),
        isActive: true,
      },
    }),
    prisma.academicTerm.create({
      data: {
        term: 2,
        year: 2569,
        startDate: new Date('2026-11-01'),
        endDate: new Date('2027-03-31'),
      },
    }),
    prisma.academicTerm.create({
      data: {
        term: 1,
        year: 2570,
        startDate: new Date('2027-05-01'),
        endDate: new Date('2027-10-31'),
      },
    }),
  ]);

  const admin = await prisma.user.create({
    data: {
      citizenId: 'e2e-admin',
      firstName: 'ผู้ดูแล',
      lastName: 'ระบบทดสอบ',
      role: Role.ADMIN,
      password: 'not-used-in-e2e',
    },
  });
  const teacher = await prisma.user.create({
    data: {
      citizenId: 'e2e-teacher',
      firstName: 'ครู',
      lastName: 'ที่ปรึกษา',
      role: Role.TEACHER,
      password: 'not-used-in-e2e',
    },
  });
  const room = await prisma.classroom.create({
    data: {
      name: 'ม.1/1',
      startingPoints: 100,
      failingThreshold: 60,
      certificateThreshold: 80,
      shieldThreshold: 90,
      termId: term1.id,
      advisors: { connect: { id: teacher.id } },
    },
  });

  const students = await Promise.all(
    ['ย้ายชั้น', 'ซ้ำชั้น', 'จบการศึกษา', 'ย้ายออก'].map((lastName, index) =>
      prisma.user.create({
        data: {
          citizenId: `e2e-student-${index + 1}`,
          firstName: `นักเรียน${index + 1}`,
          lastName,
          role: Role.STUDENT,
          password: 'not-used-in-e2e',
          classroomId: room.id,
        },
      }),
    ),
  );
  const category = await prisma.pointCategory.create({
    data: {
      name: 'หักคะแนนจำลอง',
      type: PointType.DEDUCT,
      defaultPoints: 5,
    },
  });

  await prisma.attendanceRecord.create({
    data: {
      type: 'ASSEMBLY',
      status: 'LATE',
      date: new Date('2026-06-10T01:00:00.000Z'),
      studentId: students[0].id,
      recorderId: teacher.id,
      termId: term1.id,
      // Intentionally null to simulate a record created before snapshots.
      classroomId: null,
    },
  });
  await prisma.behaviorRecord.create({
    data: {
      points: 5,
      note: 'ข้อมูลเดิมก่อน backfill',
      createdAt: new Date('2026-06-10T02:00:00.000Z'),
      categoryId: category.id,
      studentId: students[0].id,
      recorderId: teacher.id,
      // Intentionally null to simulate legacy data.
      pointDelta: null,
      classroomId: null,
      termId: null,
    },
  });

  return { term1, term2, nextYear, admin, teacher, room, students };
}

async function runPromotionFlow(prisma: PrismaService) {
  const seeded = await seedLegacyData(prisma);
  await prisma.$disconnect();

  runProjectCommand('node_modules/.bin/ts-node', [
    'scripts/backfill-student-history.ts',
  ]);
  runProjectCommand('node_modules/.bin/ts-node', [
    'scripts/backfill-student-history.ts',
    '--apply',
    `--confirm=${BACKFILL_CONFIRMATION}`,
  ]);
  runProjectCommand('node_modules/.bin/ts-node', [
    'scripts/verify-student-scores.ts',
  ]);

  await prisma.$connect();
  const historyBefore = {
    attendance: await prisma.attendanceRecord.findMany({
      orderBy: { id: 'asc' },
    }),
    behavior: await prisma.behaviorRecord.findMany({
      orderBy: { id: 'asc' },
    }),
    accounts: await prisma.studentPointAccount.findMany({
      orderBy: { studentId: 'asc' },
    }),
  };
  assert(
    historyBefore.attendance[0]?.classroomId === seeded.room.id,
    'attendance classroom snapshot was not backfilled',
  );
  assert(
    historyBefore.behavior[0]?.pointDelta === -5,
    'behavior point delta was not backfilled',
  );
  assert(
    historyBefore.accounts.length === seeded.students.length,
    'point accounts were not created for every student',
  );

  const promotions = new PromotionsService(prisma);
  const termPayload = {
    sourceTermId: seeded.term1.id,
    targetTermId: seeded.term2.id,
    classroomMappings: [
      {
        sourceClassroomId: seeded.room.id,
        targetName: 'ม.1/1',
      },
    ],
  };
  const termPreview = await promotions.previewTermRollover(termPayload);
  assert(termPreview.summary.blockingIssues === 0, 'term preview has issues');
  assert(
    termPreview.students.length === seeded.students.length,
    'term preview does not return every student',
  );

  const termResult = await promotions.applyTermRollover(seeded.admin.id, {
    ...termPayload,
    idempotencyKey: 'e2e-term-rollover-2569',
    activateTargetTerm: true,
  });
  assert(
    termResult.batch.status === PromotionStatus.APPLIED,
    'term rollover batch was not applied',
  );
  const termRetry = await promotions.applyTermRollover(seeded.admin.id, {
    ...termPayload,
    idempotencyKey: 'e2e-term-rollover-2569',
    activateTargetTerm: true,
  });
  assert(
    termRetry.idempotent === true,
    'term rollover retry is not idempotent',
  );

  const term2Room = await prisma.classroom.findFirstOrThrow({
    where: { termId: seeded.term2.id, name: 'ม.1/1' },
  });
  const annualPayload = {
    sourceTermId: seeded.term2.id,
    targetTermId: seeded.nextYear.id,
    classroomMappings: [
      {
        sourceClassroomId: term2Room.id,
        targetName: 'ม.2/1',
        defaultAction: PromotionAction.MOVE,
      },
    ],
    studentOverrides: [
      {
        studentId: seeded.students[1].id,
        action: PromotionAction.REPEAT,
        targetSourceClassroomId: term2Room.id,
      },
      {
        studentId: seeded.students[2].id,
        action: PromotionAction.GRADUATE,
      },
      {
        studentId: seeded.students[3].id,
        action: PromotionAction.TRANSFER_OUT,
      },
    ],
  };
  const annualPreview = await promotions.previewAnnualPromotion(annualPayload);
  assert(
    annualPreview.summary.blockingIssues === 0,
    'annual preview has issues',
  );
  assert(
    annualPreview.summary.studentsToMove === 1 &&
      annualPreview.summary.studentsToRepeat === 1 &&
      annualPreview.summary.studentsToGraduate === 1 &&
      annualPreview.summary.studentsToTransferOut === 1,
    'annual preview action counts are incorrect',
  );

  const annualResult = await promotions.applyAnnualPromotion(seeded.admin.id, {
    ...annualPayload,
    idempotencyKey: 'e2e-annual-promotion-2570',
    activateTargetTerm: true,
  });
  assert(
    annualResult.batch.status === PromotionStatus.APPLIED,
    'annual promotion batch was not applied',
  );
  const annualRetry = await promotions.applyAnnualPromotion(seeded.admin.id, {
    ...annualPayload,
    idempotencyKey: 'e2e-annual-promotion-2570',
    activateTargetTerm: true,
  });
  assert(
    annualRetry.idempotent === true,
    'annual promotion retry is not idempotent',
  );

  const annualBatch = await prisma.promotionBatch.findFirstOrThrow({
    where: { type: PromotionType.ANNUAL_PROMOTION },
    include: { items: true },
  });
  assert(
    annualBatch.items.length === seeded.students.length,
    'annual audit does not include every student',
  );

  const term2Enrollments = await prisma.studentEnrollment.findMany({
    where: { termId: seeded.term2.id },
  });
  const exitReasonByStudent = new Map(
    term2Enrollments.map((item) => [item.studentId, item.exitReason]),
  );
  assert(
    exitReasonByStudent.get(seeded.students[0].id) ===
      EnrollmentExitReason.PROMOTED,
    'moved student has incorrect exit reason',
  );
  assert(
    exitReasonByStudent.get(seeded.students[1].id) ===
      EnrollmentExitReason.REPEATED,
    'repeated student has incorrect exit reason',
  );
  assert(
    exitReasonByStudent.get(seeded.students[2].id) ===
      EnrollmentExitReason.GRADUATED,
    'graduated student has incorrect exit reason',
  );
  assert(
    exitReasonByStudent.get(seeded.students[3].id) ===
      EnrollmentExitReason.TRANSFERRED,
    'transferred student has incorrect exit reason',
  );

  const activeEnrollments = await prisma.studentEnrollment.findMany({
    where: {
      termId: seeded.nextYear.id,
      status: EnrollmentStatus.ACTIVE,
    },
  });
  assert(
    activeEnrollments.length === 2,
    'only moved and repeated students should remain active',
  );

  const historyAfter = {
    attendance: await prisma.attendanceRecord.findMany({
      orderBy: { id: 'asc' },
    }),
    behavior: await prisma.behaviorRecord.findMany({
      orderBy: { id: 'asc' },
    }),
    accounts: await prisma.studentPointAccount.findMany({
      orderBy: { studentId: 'asc' },
    }),
  };
  assert(
    JSON.stringify(historyAfter) === JSON.stringify(historyBefore),
    'promotion changed historical records or point accounts',
  );

  const activeTerm = await prisma.academicTerm.findFirstOrThrow({
    where: { isActive: true },
  });
  assert(
    activeTerm.id === seeded.nextYear.id,
    'target academic term was not activated',
  );
}

async function main() {
  let serverConnection: Connection | undefined;
  let databaseCreated = false;
  let prisma: PrismaService | undefined;

  try {
    serverConnection = await createDatabase();
    databaseCreated = true;
    console.log(`Created isolated E2E database: ${databaseName}`);

    runProjectCommand('node_modules/.bin/prisma', ['migrate', 'deploy']);
    process.env.DATABASE_URL = testUrl.toString();
    prisma = new PrismaService();
    await prisma.$connect();
    await runPromotionFlow(prisma);
    console.log('Promotion E2E passed: history and scores remained unchanged.');
  } finally {
    if (prisma) await prisma.$disconnect();
    if (serverConnection && databaseCreated) {
      await serverConnection.query(`DROP DATABASE \`${databaseName}\``);
      console.log(`Dropped isolated E2E database: ${databaseName}`);
    }
    if (serverConnection) await serverConnection.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack : String(error);
  console.error(message);
  process.exitCode = 1;
});
