import {
  EnrollmentExitReason,
  EnrollmentStatus,
  PointType,
  Prisma,
} from '@prisma/client';
import { calculateLegacyPointDelta } from '../points/score-calculator';

const TIMEZONE = 'Asia/Bangkok';
export const BACKFILL_CONFIRMATION = 'BACKFILL_STUDENT_HISTORY_V1';

export interface BackfillTerm {
  id: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
}

export interface BackfillStudent {
  id: string;
  createdAt: Date;
  classroom: {
    id: number;
    startingPoints: number;
    termId: number;
    term: BackfillTerm;
  } | null;
}

export interface BackfillAttendance {
  id: string;
  termId: number;
  classroomId: number | null;
  student: {
    id: string;
    classroom: { id: number; termId: number } | null;
  };
}

export interface BackfillBehavior {
  id: string;
  points: number;
  pointDelta: number | null;
  classroomId: number | null;
  termId: number | null;
  createdAt: Date;
  category: { type: PointType } | null;
  student: {
    id: string;
    classroom: { id: number; termId: number } | null;
  };
}

export interface ExistingPointAccount {
  studentId: string;
  initialPoints: number;
}

export interface ExistingEnrollment {
  studentId: string;
  classroomId: number;
  termId: number;
  status: EnrollmentStatus;
}

export interface BackfillIssue {
  blocking: boolean;
  code: string;
  entityType: 'STUDENT' | 'ATTENDANCE' | 'BEHAVIOR';
  entityId: string;
  message: string;
}

export interface StudentHistoryBackfillPlan {
  pointAccounts: Prisma.StudentPointAccountCreateManyInput[];
  enrollments: Prisma.StudentEnrollmentCreateManyInput[];
  attendanceUpdates: Array<{ id: string; classroomId: number }>;
  behaviorUpdates: Array<{
    id: string;
    classroomId?: number;
    termId?: number;
    pointDelta?: number;
  }>;
  issues: BackfillIssue[];
  summary: {
    students: number;
    attendanceRecords: number;
    behaviorRecords: number;
    pointAccountsToCreate: number;
    enrollmentsToCreate: number;
    attendanceRecordsToUpdate: number;
    behaviorRecordsToUpdate: number;
    blockingIssues: number;
    warnings: number;
  };
}

export interface StudentHistoryBackfillInput {
  students: BackfillStudent[];
  terms: BackfillTerm[];
  attendanceRecords: BackfillAttendance[];
  behaviorRecords: BackfillBehavior[];
  pointAccounts: ExistingPointAccount[];
  enrollments: ExistingEnrollment[];
}

const dateKeyInBangkok = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

const laterDate = (left: Date, right: Date) =>
  left.getTime() > right.getTime() ? left : right;

const findTermsAt = (terms: BackfillTerm[], date: Date) => {
  const target = dateKeyInBangkok(date);
  return terms.filter(
    (term) =>
      dateKeyInBangkok(term.startDate) <= target &&
      dateKeyInBangkok(term.endDate) >= target,
  );
};

const addIssue = (
  issues: BackfillIssue[],
  issue: Omit<BackfillIssue, 'blocking'> & { blocking?: boolean },
) => {
  issues.push({ ...issue, blocking: issue.blocking ?? true });
};

export function buildStudentHistoryBackfillPlan(
  input: StudentHistoryBackfillInput,
): StudentHistoryBackfillPlan {
  const issues: BackfillIssue[] = [];
  const pointAccounts: Prisma.StudentPointAccountCreateManyInput[] = [];
  const enrollments: Prisma.StudentEnrollmentCreateManyInput[] = [];
  const attendanceUpdates: StudentHistoryBackfillPlan['attendanceUpdates'] = [];
  const behaviorUpdates: StudentHistoryBackfillPlan['behaviorUpdates'] = [];
  const pointAccountByStudent = new Map(
    input.pointAccounts.map((account) => [account.studentId, account]),
  );
  const enrollmentsByStudent = new Map<string, ExistingEnrollment[]>();

  for (const enrollment of input.enrollments) {
    const existing = enrollmentsByStudent.get(enrollment.studentId) ?? [];
    existing.push(enrollment);
    enrollmentsByStudent.set(enrollment.studentId, existing);
  }

  for (const student of input.students) {
    if (!student.classroom) {
      addIssue(issues, {
        code: 'STUDENT_WITHOUT_CLASSROOM',
        entityType: 'STUDENT',
        entityId: student.id,
        message:
          'ไม่สามารถสร้างบัญชีคะแนนหรือประวัติห้องได้ เพราะนักเรียนไม่มีห้องปัจจุบัน',
      });
      continue;
    }

    const account = pointAccountByStudent.get(student.id);
    if (!account) {
      pointAccounts.push({
        studentId: student.id,
        initialPoints: student.classroom.startingPoints,
      });
    } else if (account.initialPoints !== student.classroom.startingPoints) {
      addIssue(issues, {
        code: 'POINT_ACCOUNT_CONFLICT',
        entityType: 'STUDENT',
        entityId: student.id,
        message: 'คะแนนตั้งต้นที่มีอยู่ไม่ตรงกับคะแนนตั้งต้นของห้องปัจจุบัน',
      });
    }

    const studentEnrollments = enrollmentsByStudent.get(student.id) ?? [];
    const exactEnrollments = studentEnrollments.filter(
      (enrollment) =>
        enrollment.classroomId === student.classroom?.id &&
        enrollment.termId === student.classroom?.termId,
    );
    const conflictingActiveEnrollments = studentEnrollments.filter(
      (enrollment) =>
        enrollment.status === EnrollmentStatus.ACTIVE &&
        (enrollment.classroomId !== student.classroom?.id ||
          enrollment.termId !== student.classroom?.termId),
    );
    const expectedEnrollmentStatus = student.classroom.term.isActive
      ? EnrollmentStatus.ACTIVE
      : EnrollmentStatus.ENDED;

    if (conflictingActiveEnrollments.length > 0) {
      addIssue(issues, {
        code: 'ACTIVE_ENROLLMENT_CONFLICT',
        entityType: 'STUDENT',
        entityId: student.id,
        message: 'มีประวัติห้องสถานะ ACTIVE ที่ไม่ตรงกับห้องปัจจุบัน',
      });
    } else if (exactEnrollments.length > 1) {
      addIssue(issues, {
        code: 'DUPLICATE_ENROLLMENT',
        entityType: 'STUDENT',
        entityId: student.id,
        message: 'พบประวัติห้องของนักเรียนซ้ำกัน',
      });
    } else if (
      exactEnrollments.length === 1 &&
      exactEnrollments[0].status !== expectedEnrollmentStatus
    ) {
      addIssue(issues, {
        code: 'ENROLLMENT_STATUS_CONFLICT',
        entityType: 'STUDENT',
        entityId: student.id,
        message: 'สถานะประวัติห้องไม่สอดคล้องกับสถานะภาคเรียน',
      });
    } else if (exactEnrollments.length === 0) {
      const term = student.classroom.term;
      enrollments.push({
        studentId: student.id,
        classroomId: student.classroom.id,
        termId: student.classroom.termId,
        status: expectedEnrollmentStatus,
        exitReason: term.isActive ? null : EnrollmentExitReason.TERM_COMPLETED,
        startedAt: laterDate(student.createdAt, term.startDate),
        endedAt: term.isActive ? null : term.endDate,
      });
    }
  }

  for (const record of input.attendanceRecords) {
    const classroom = record.student.classroom;
    if (!classroom) {
      addIssue(issues, {
        code: 'ATTENDANCE_STUDENT_WITHOUT_CLASSROOM',
        entityType: 'ATTENDANCE',
        entityId: record.id,
        message: 'ไม่สามารถระบุห้องของรายการเช็กชื่อได้',
      });
      continue;
    }
    if (classroom.termId !== record.termId) {
      addIssue(issues, {
        code: 'ATTENDANCE_TERM_CLASSROOM_MISMATCH',
        entityType: 'ATTENDANCE',
        entityId: record.id,
        message:
          'เทอมของรายการเช็กชื่อไม่ตรงกับเทอมของห้องปัจจุบัน ต้องจับคู่ห้องเดิมด้วยตนเอง',
      });
      continue;
    }
    if (record.classroomId === null) {
      attendanceUpdates.push({ id: record.id, classroomId: classroom.id });
    } else if (record.classroomId !== classroom.id) {
      addIssue(issues, {
        code: 'ATTENDANCE_CLASSROOM_CONFLICT',
        entityType: 'ATTENDANCE',
        entityId: record.id,
        message: 'snapshot ห้องที่มีอยู่ไม่ตรงกับห้องที่ระบบอนุมานได้',
      });
    }
  }

  for (const record of input.behaviorRecords) {
    const classroom = record.student.classroom;
    if (!classroom) {
      addIssue(issues, {
        code: 'BEHAVIOR_STUDENT_WITHOUT_CLASSROOM',
        entityType: 'BEHAVIOR',
        entityId: record.id,
        message: 'ไม่สามารถระบุห้องของประวัติพฤติกรรมได้',
      });
      continue;
    }

    const matchingTerms = findTermsAt(input.terms, record.createdAt);
    if (matchingTerms.length !== 1) {
      addIssue(issues, {
        code:
          matchingTerms.length === 0
            ? 'BEHAVIOR_TERM_NOT_FOUND'
            : 'BEHAVIOR_TERM_OVERLAP',
        entityType: 'BEHAVIOR',
        entityId: record.id,
        message:
          matchingTerms.length === 0
            ? 'ไม่พบภาคเรียนที่ครอบคลุมวันที่บันทึกพฤติกรรม'
            : 'พบมากกว่าหนึ่งภาคเรียนที่ครอบคลุมวันที่บันทึกพฤติกรรม',
      });
      continue;
    }

    const term = matchingTerms[0];
    if (classroom.termId !== term.id) {
      addIssue(issues, {
        code: 'BEHAVIOR_TERM_CLASSROOM_MISMATCH',
        entityType: 'BEHAVIOR',
        entityId: record.id,
        message:
          'เทอมของประวัติไม่ตรงกับเทอมของห้องปัจจุบัน ต้องจับคู่ห้องเดิมด้วยตนเอง',
      });
      continue;
    }

    const delta = calculateLegacyPointDelta(record);
    const update: StudentHistoryBackfillPlan['behaviorUpdates'][number] = {
      id: record.id,
    };

    if (record.classroomId === null) update.classroomId = classroom.id;
    else if (record.classroomId !== classroom.id) {
      addIssue(issues, {
        code: 'BEHAVIOR_CLASSROOM_CONFLICT',
        entityType: 'BEHAVIOR',
        entityId: record.id,
        message: 'snapshot ห้องที่มีอยู่ไม่ตรงกับห้องที่ระบบอนุมานได้',
      });
    }

    if (record.termId === null) update.termId = term.id;
    else if (record.termId !== term.id) {
      addIssue(issues, {
        code: 'BEHAVIOR_TERM_CONFLICT',
        entityType: 'BEHAVIOR',
        entityId: record.id,
        message: 'snapshot ภาคเรียนที่มีอยู่ไม่ตรงกับวันที่บันทึก',
      });
    }

    if (record.pointDelta === null) update.pointDelta = delta;
    else if (record.pointDelta !== delta) {
      addIssue(issues, {
        code: 'BEHAVIOR_POINT_DELTA_CONFLICT',
        entityType: 'BEHAVIOR',
        entityId: record.id,
        message: 'pointDelta ที่มีอยู่ไม่ตรงกับวิธีคำนวณเดิม',
      });
    }

    if (Object.keys(update).length > 1) behaviorUpdates.push(update);
  }

  const blockingIssues = issues.filter((issue) => issue.blocking).length;
  return {
    pointAccounts,
    enrollments,
    attendanceUpdates,
    behaviorUpdates,
    issues,
    summary: {
      students: input.students.length,
      attendanceRecords: input.attendanceRecords.length,
      behaviorRecords: input.behaviorRecords.length,
      pointAccountsToCreate: pointAccounts.length,
      enrollmentsToCreate: enrollments.length,
      attendanceRecordsToUpdate: attendanceUpdates.length,
      behaviorRecordsToUpdate: behaviorUpdates.length,
      blockingIssues,
      warnings: issues.length - blockingIssues,
    },
  };
}

const groupIdsByValue = <T extends string | number>(
  entries: Array<{ id: string; value: T }>,
) => {
  const groups = new Map<T, string[]>();
  for (const entry of entries) {
    const ids = groups.get(entry.value) ?? [];
    ids.push(entry.id);
    groups.set(entry.value, ids);
  }
  return groups;
};

const chunks = <T>(items: T[], size = 500) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

export async function applyStudentHistoryBackfill(
  prisma: {
    $transaction: <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { maxWait?: number; timeout?: number },
    ) => Promise<T>;
  },
  plan: StudentHistoryBackfillPlan,
) {
  if (plan.summary.blockingIssues > 0) {
    throw new Error(
      `ยกเลิกการ backfill เพราะพบปัญหาที่ต้องแก้ ${plan.summary.blockingIssues} รายการ`,
    );
  }

  return prisma.$transaction(
    async (tx) => {
      if (plan.pointAccounts.length > 0) {
        await tx.studentPointAccount.createMany({
          data: plan.pointAccounts,
          skipDuplicates: true,
        });
      }
      if (plan.enrollments.length > 0) {
        await tx.studentEnrollment.createMany({ data: plan.enrollments });
      }

      const attendanceGroups = groupIdsByValue(
        plan.attendanceUpdates.map((update) => ({
          id: update.id,
          value: update.classroomId,
        })),
      );
      for (const [classroomId, ids] of attendanceGroups) {
        for (const idChunk of chunks(ids)) {
          await tx.attendanceRecord.updateMany({
            where: { id: { in: idChunk }, classroomId: null },
            data: { classroomId },
          });
        }
      }

      const classroomGroups = groupIdsByValue(
        plan.behaviorUpdates.flatMap((update) =>
          update.classroomId === undefined
            ? []
            : [{ id: update.id, value: update.classroomId }],
        ),
      );
      for (const [classroomId, ids] of classroomGroups) {
        for (const idChunk of chunks(ids)) {
          await tx.behaviorRecord.updateMany({
            where: { id: { in: idChunk }, classroomId: null },
            data: { classroomId },
          });
        }
      }

      const termGroups = groupIdsByValue(
        plan.behaviorUpdates.flatMap((update) =>
          update.termId === undefined
            ? []
            : [{ id: update.id, value: update.termId }],
        ),
      );
      for (const [termId, ids] of termGroups) {
        for (const idChunk of chunks(ids)) {
          await tx.behaviorRecord.updateMany({
            where: { id: { in: idChunk }, termId: null },
            data: { termId },
          });
        }
      }

      const deltaGroups = groupIdsByValue(
        plan.behaviorUpdates.flatMap((update) =>
          update.pointDelta === undefined
            ? []
            : [{ id: update.id, value: update.pointDelta }],
        ),
      );
      for (const [pointDelta, ids] of deltaGroups) {
        for (const idChunk of chunks(ids)) {
          await tx.behaviorRecord.updateMany({
            where: { id: { in: idChunk }, pointDelta: null },
            data: { pointDelta },
          });
        }
      }

      return plan.summary;
    },
    { maxWait: 10_000, timeout: 300_000 },
  );
}
