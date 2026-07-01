import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  EnrollmentExitReason,
  EnrollmentStatus,
  Prisma,
  Role,
} from '@prisma/client';

type AcademicContextClient = Pick<
  Prisma.TransactionClient,
  'classroom' | 'user'
>;

export interface ClassroomAcademicContext {
  classroomId: number;
  termId: number;
  startingPoints: number;
  termIsActive: boolean;
  termStartDate: Date;
  termEndDate: Date;
}

export interface StudentAcademicContext extends ClassroomAcademicContext {
  studentId: string;
}

export async function requireClassroomAcademicContext(
  prisma: AcademicContextClient,
  classroomId: number,
): Promise<ClassroomAcademicContext> {
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: {
      id: true,
      termId: true,
      startingPoints: true,
      term: {
        select: {
          isActive: true,
          startDate: true,
          endDate: true,
        },
      },
    },
  });

  if (!classroom) {
    throw new NotFoundException(`ไม่พบห้องเรียน ID: ${classroomId}`);
  }

  return {
    classroomId: classroom.id,
    termId: classroom.termId,
    startingPoints: classroom.startingPoints,
    termIsActive: classroom.term.isActive,
    termStartDate: classroom.term.startDate,
    termEndDate: classroom.term.endDate,
  };
}

export async function requireStudentAcademicContexts(
  prisma: AcademicContextClient,
  studentIds: string[],
  expectedTermId?: number,
): Promise<Map<string, StudentAcademicContext>> {
  const uniqueIds = [...new Set(studentIds)];
  const students = await prisma.user.findMany({
    where: {
      id: { in: uniqueIds },
      role: Role.STUDENT,
    },
    select: {
      id: true,
      classroom: {
        select: {
          id: true,
          termId: true,
          startingPoints: true,
          term: {
            select: {
              isActive: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      },
    },
  });

  if (students.length !== uniqueIds.length) {
    const foundIds = new Set(students.map((student) => student.id));
    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
    throw new NotFoundException(
      `ไม่พบนักเรียนในระบบ: ${missingIds.join(', ')}`,
    );
  }

  const contexts = new Map<string, StudentAcademicContext>();
  for (const student of students) {
    if (!student.classroom) {
      throw new BadRequestException(
        `นักเรียน ID ${student.id} ยังไม่มีห้องเรียนปัจจุบัน`,
      );
    }
    if (
      expectedTermId !== undefined &&
      student.classroom.termId !== expectedTermId
    ) {
      throw new BadRequestException(
        `นักเรียน ID ${student.id} ไม่ได้อยู่ในภาคเรียนปัจจุบัน`,
      );
    }

    contexts.set(student.id, {
      studentId: student.id,
      classroomId: student.classroom.id,
      termId: student.classroom.termId,
      startingPoints: student.classroom.startingPoints,
      termIsActive: student.classroom.term.isActive,
      termStartDate: student.classroom.term.startDate,
      termEndDate: student.classroom.term.endDate,
    });
  }

  return contexts;
}

export async function requireStudentAcademicContext(
  prisma: AcademicContextClient,
  studentId: string,
  expectedTermId?: number,
) {
  const contexts = await requireStudentAcademicContexts(
    prisma,
    [studentId],
    expectedTermId,
  );
  return contexts.get(studentId) as StudentAcademicContext;
}

export const enrollmentDataForContext = (
  context: ClassroomAcademicContext,
  startedAt: Date,
) => ({
  classroomId: context.classroomId,
  termId: context.termId,
  status: context.termIsActive
    ? EnrollmentStatus.ACTIVE
    : EnrollmentStatus.ENDED,
  exitReason: context.termIsActive ? null : EnrollmentExitReason.TERM_COMPLETED,
  startedAt:
    startedAt.getTime() > context.termStartDate.getTime()
      ? startedAt
      : context.termStartDate,
  endedAt: context.termIsActive ? null : context.termEndDate,
});
