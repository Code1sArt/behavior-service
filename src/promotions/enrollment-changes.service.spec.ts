import {
  EnrollmentChangeAction,
  EnrollmentExitReason,
  EnrollmentStatus,
} from '@prisma/client';
import { PromotionsService } from './promotions.service';

const term = {
  id: 1,
  term: 1,
  year: 2569,
  startDate: new Date('2026-05-01T00:00:00.000Z'),
  endDate: new Date('2026-10-01T00:00:00.000Z'),
  isActive: true,
};

const activeEnrollment = {
  id: 'enrollment-active',
  studentId: 'student-1',
  classroomId: 10,
  termId: 1,
  status: EnrollmentStatus.ACTIVE,
  exitReason: null,
  student: { classroomId: 10 },
};

const studyLeaveEnrollment = {
  id: 'enrollment-leave',
  studentId: 'student-2',
  classroomId: 10,
  termId: 1,
  status: EnrollmentStatus.ENDED,
  exitReason: EnrollmentExitReason.STUDY_LEAVE,
  endedAt: new Date('2026-07-01T00:00:00.000Z'),
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};

const transferredEnrollment = {
  ...studyLeaveEnrollment,
  id: 'enrollment-transferred',
  studentId: 'student-3',
  exitReason: EnrollmentExitReason.TRANSFERRED,
};

const createEnrollmentChangeMock = () => {
  let closeArguments: unknown;
  let createEnrollmentArguments: unknown;
  let userUpdateArguments: unknown;
  let userUpdateManyArguments: unknown;
  let itemCreateArguments: unknown;

  const enrollmentFindMany = jest.fn(
    ({ where }: { where: { status: EnrollmentStatus } }) => {
      if (where.status === EnrollmentStatus.ACTIVE) {
        return Promise.resolve([activeEnrollment]);
      }
      return Promise.resolve([studyLeaveEnrollment]);
    },
  );
  const enrollmentUpdateMany = jest.fn((args: unknown) => {
    closeArguments = args;
    return Promise.resolve({ count: 1 });
  });
  const enrollmentCreate = jest.fn((args: unknown) => {
    createEnrollmentArguments = args;
    return Promise.resolve({ id: 'enrollment-returned' });
  });
  const userUpdate = jest.fn((args: unknown) => {
    userUpdateArguments = args;
    return Promise.resolve({ id: 'student' });
  });
  const userUpdateMany = jest.fn((args: unknown) => {
    userUpdateManyArguments = args;
    return Promise.resolve({ count: 1 });
  });
  const itemCreate = jest.fn((args: unknown) => {
    itemCreateArguments = args;
    return Promise.resolve({ id: 'item-1' });
  });
  const batch = {
    id: 'batch-1',
    idempotencyKey: 'enrollment-change-key',
    termId: 1,
    items: [],
  };

  const prisma = {
    academicTerm: { findUnique: jest.fn().mockResolvedValue(term) },
    classroom: {
      findMany: jest.fn().mockResolvedValue([{ id: 20 }]),
    },
    studentEnrollment: {
      findMany: enrollmentFindMany,
      updateMany: enrollmentUpdateMany,
      create: enrollmentCreate,
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'student-1', classroomId: 10 },
        { id: 'student-2', classroomId: null },
      ]),
      update: userUpdate,
      updateMany: userUpdateMany,
    },
    enrollmentChangeBatch: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(batch),
      create: jest.fn().mockResolvedValue(batch),
    },
    enrollmentChangeItem: { create: itemCreate },
  };
  const transaction = jest.fn((callback: (tx: typeof prisma) => unknown) =>
    callback(prisma),
  );

  return {
    prisma: { ...prisma, $transaction: transaction },
    enrollmentFindMany,
    getArguments: () => ({
      closeArguments,
      createEnrollmentArguments,
      userUpdateArguments,
      userUpdateManyArguments,
      itemCreateArguments,
    }),
  };
};

describe('PromotionsService enrollment changes', () => {
  it('previews study leave without writing data', async () => {
    const mock = createEnrollmentChangeMock();
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.previewEnrollmentChanges({
      termId: 1,
      changes: [
        {
          studentId: 'student-1',
          action: EnrollmentChangeAction.STUDY_LEAVE,
        },
      ],
    });

    expect(result.summary).toEqual(
      expect.objectContaining({ total: 1, studyLeave: 1, blockingIssues: 0 }),
    );
  });

  it('closes enrollment and clears classroom when applying study leave', async () => {
    const mock = createEnrollmentChangeMock();
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.applyEnrollmentChanges('admin-1', {
      termId: 1,
      idempotencyKey: 'enrollment-change-key',
      changes: [
        {
          studentId: 'student-1',
          action: EnrollmentChangeAction.STUDY_LEAVE,
        },
      ],
    });
    const args = mock.getArguments();
    const closedEnrollment = args.closeArguments as {
      data: { status: EnrollmentStatus; exitReason: EnrollmentExitReason };
    };
    const auditItem = args.itemCreateArguments as {
      data: { action: EnrollmentChangeAction; sourceEnrollmentId: string };
    };

    expect(result.idempotent).toBe(false);
    expect(closedEnrollment.data).toMatchObject({
      status: EnrollmentStatus.ENDED,
      exitReason: EnrollmentExitReason.STUDY_LEAVE,
    });
    expect(args.userUpdateArguments).toEqual({
      where: { id: 'student-1' },
      data: { classroomId: null },
    });
    expect(auditItem.data).toMatchObject({
      action: EnrollmentChangeAction.STUDY_LEAVE,
      sourceEnrollmentId: 'enrollment-active',
    });
  });

  it('creates a new active enrollment when returning from study leave', async () => {
    const mock = createEnrollmentChangeMock();
    mock.enrollmentFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([studyLeaveEnrollment]);
    const service = new PromotionsService(mock.prisma as never);

    await service.applyEnrollmentChanges('admin-1', {
      termId: 1,
      idempotencyKey: 'return-study-key',
      changes: [
        {
          studentId: 'student-2',
          action: EnrollmentChangeAction.RETURN_TO_STUDY,
          targetClassroomId: 20,
        },
      ],
    });
    const args = mock.getArguments();
    const createdEnrollment = args.createEnrollmentArguments as {
      data: {
        studentId: string;
        classroomId: number;
        termId: number;
        status: EnrollmentStatus;
      };
    };

    expect(createdEnrollment.data).toMatchObject({
      studentId: 'student-2',
      classroomId: 20,
      termId: 1,
      status: EnrollmentStatus.ACTIVE,
    });
    expect(args.userUpdateManyArguments).toEqual({
      where: { id: 'student-2', classroomId: null },
      data: { classroomId: 20 },
    });
  });

  it('includes both study-leave and transferred students in the inactive list', async () => {
    const prisma = {
      academicTerm: { findUnique: jest.fn().mockResolvedValue(term) },
      classroom: { findMany: jest.fn().mockResolvedValue([]) },
      studentEnrollment: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...studyLeaveEnrollment,
            student: {
              id: 'student-2',
              citizenId: '1002',
              firstName: 'พัก',
              lastName: 'การเรียน',
            },
            classroom: { id: 10, name: 'ม.1/1' },
          },
          {
            ...transferredEnrollment,
            student: {
              id: 'student-3',
              citizenId: '1003',
              firstName: 'ย้าย',
              lastName: 'ออก',
            },
            classroom: { id: 10, name: 'ม.1/1' },
          },
        ]),
      },
    };
    const service = new PromotionsService(prisma as never);

    const result = await service.getEnrollmentChangeCandidates(1);

    expect(result.inactiveStudents).toHaveLength(2);
    expect(result.studyLeaveStudents).toHaveLength(1);
    expect(result.transferOutStudents).toHaveLength(1);
    expect(
      result.inactiveStudents.map((student) => student.exitReason),
    ).toEqual(
      expect.arrayContaining([
        EnrollmentExitReason.STUDY_LEAVE,
        EnrollmentExitReason.TRANSFERRED,
      ]),
    );
  });

  it('allows a transferred student to be received again', async () => {
    const mock = createEnrollmentChangeMock();
    mock.enrollmentFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([transferredEnrollment]);
    mock.prisma.user.findMany.mockResolvedValue([
      { id: 'student-3', classroomId: null },
    ]);
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.previewEnrollmentChanges({
      termId: 1,
      changes: [
        {
          studentId: 'student-3',
          action: EnrollmentChangeAction.RETURN_TO_STUDY,
          targetClassroomId: 20,
        },
      ],
    });

    expect(result.issues).toHaveLength(0);
    expect(result.summary.returnToStudy).toBe(1);
  });
});
