import {
  EnrollmentStatus,
  PromotionAction,
  PromotionStatus,
  PromotionType,
} from '@prisma/client';
import { PromotionsService } from './promotions.service';

const sourceTerm = {
  id: 1,
  term: 1,
  year: 2569,
  startDate: new Date('2026-05-01T00:00:00.000Z'),
  endDate: new Date('2026-10-01T00:00:00.000Z'),
  isActive: true,
};

const targetTerm = {
  id: 2,
  term: 2,
  year: 2569,
  startDate: new Date('2026-11-01T00:00:00.000Z'),
  endDate: new Date('2027-03-31T00:00:00.000Z'),
  isActive: false,
};

const nextYearTerm = {
  ...targetTerm,
  id: 3,
  term: 1,
  year: 2570,
};

const sourceRoom = {
  id: 10,
  name: 'ม.1/1',
  termId: 1,
  startingPoints: 100,
  failingThreshold: 50,
  certificateThreshold: 80,
  shieldThreshold: 90,
  advisors: [{ id: 'teacher-1' }],
  students: [{ id: 'student-1' }],
  enrollments: [
    {
      id: 'enrollment-1',
      studentId: 'student-1',
      student: {
        id: 'student-1',
        citizenId: '1234567890123',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        classroomId: 10,
      },
    },
  ],
};

const createPrismaMock = () => {
  let createClassroomArguments: unknown;
  let closeEnrollmentArguments: unknown;
  let createEnrollmentArguments: unknown;
  let updateUserArguments: unknown;
  let createBatchArguments: unknown;
  let createItemsArguments: unknown;

  const promotionBatchFindUnique = jest.fn().mockResolvedValue(null);
  const classroomCreate = jest.fn((argumentsValue: unknown) => {
    createClassroomArguments = argumentsValue;
    return Promise.resolve({ id: 20 });
  });
  const enrollmentUpdateMany = jest.fn((argumentsValue: unknown) => {
    closeEnrollmentArguments = argumentsValue;
    return Promise.resolve({ count: 1 });
  });
  const enrollmentCreate = jest.fn((argumentsValue: unknown) => {
    createEnrollmentArguments = argumentsValue;
    return Promise.resolve({ id: 'enrollment-2' });
  });
  const userUpdate = jest.fn((argumentsValue: unknown) => {
    updateUserArguments = argumentsValue;
    return Promise.resolve({ id: 'student-1' });
  });
  const batchCreate = jest.fn((argumentsValue: unknown) => {
    createBatchArguments = argumentsValue;
    return Promise.resolve({ id: 'batch-1' });
  });
  const itemCreateMany = jest.fn((argumentsValue: unknown) => {
    createItemsArguments = argumentsValue;
    return Promise.resolve({ count: 1 });
  });
  const batchUpdate = jest.fn().mockResolvedValue({
    id: 'batch-1',
    status: PromotionStatus.APPLIED,
    items: [],
  });

  const prisma = {
    academicTerm: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? sourceTerm : targetTerm),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(targetTerm),
    },
    classroom: {
      findMany: jest.fn(({ where }: { where: { termId: number } }) =>
        Promise.resolve(where.termId === 1 ? [sourceRoom] : []),
      ),
      create: classroomCreate,
    },
    studentEnrollment: {
      findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1' }]),
      updateMany: enrollmentUpdateMany,
      create: enrollmentCreate,
    },
    user: {
      update: userUpdate,
    },
    promotionBatch: {
      findUnique: promotionBatchFindUnique,
      create: batchCreate,
      update: batchUpdate,
    },
    promotionItem: {
      createMany: itemCreateMany,
    },
  };

  const transaction = jest.fn((callback: (client: typeof prisma) => unknown) =>
    callback(prisma),
  );

  return {
    prisma: { ...prisma, $transaction: transaction },
    transaction,
    promotionBatchFindUnique,
    classroomCreate,
    enrollmentUpdateMany,
    enrollmentCreate,
    userUpdate,
    batchCreate,
    itemCreateMany,
    getArguments: () => ({
      createClassroomArguments,
      closeEnrollmentArguments,
      createEnrollmentArguments,
      updateUserArguments,
      createBatchArguments,
      createItemsArguments,
    }),
  };
};

describe('PromotionsService term rollover', () => {
  it('previews classroom cloning without writing data', async () => {
    const mock = createPrismaMock();
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.previewTermRollover({
      sourceTermId: 1,
      targetTermId: 2,
    });

    expect(result.summary).toEqual(
      expect.objectContaining({
        classroomsToCreate: 1,
        studentsToMove: 1,
        blockingIssues: 0,
      }),
    );
    expect(result.students).toEqual([
      expect.objectContaining({
        studentId: 'student-1',
        citizenId: '1234567890123',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        action: PromotionAction.MOVE,
      }),
    ]);
    expect(mock.classroomCreate).not.toHaveBeenCalled();
    expect(mock.batchCreate).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('applies the whole rollover without changing point accounts', async () => {
    const mock = createPrismaMock();
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.applyTermRollover('admin-1', {
      sourceTermId: 1,
      targetTermId: 2,
      idempotencyKey: 'rollover-2569-term-2',
      activateTargetTerm: true,
    });
    const captured = mock.getArguments();
    const createdClassroom = captured.createClassroomArguments as {
      data: {
        name: string;
        termId: number;
        advisors: { connect: Array<{ id: string }> };
      };
    };
    const closedEnrollment = captured.closeEnrollmentArguments as {
      where: { studentId: string; status: EnrollmentStatus };
    };
    const createdEnrollment = captured.createEnrollmentArguments as {
      data: {
        studentId: string;
        classroomId: number;
        termId: number;
        status: EnrollmentStatus;
      };
    };
    const createdBatch = captured.createBatchArguments as {
      data: { type: PromotionType; idempotencyKey: string };
    };

    expect(result.idempotent).toBe(false);
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(createdClassroom.data).toMatchObject({
      name: 'ม.1/1',
      termId: 2,
      advisors: { connect: [{ id: 'teacher-1' }] },
    });
    expect(closedEnrollment.where).toMatchObject({
      studentId: 'student-1',
      status: EnrollmentStatus.ACTIVE,
    });
    expect(createdEnrollment.data).toMatchObject({
      studentId: 'student-1',
      classroomId: 20,
      termId: 2,
      status: EnrollmentStatus.ACTIVE,
    });
    expect(captured.updateUserArguments).toEqual({
      where: { id: 'student-1' },
      data: { classroomId: 20 },
    });
    expect(createdBatch.data).toMatchObject({
      type: PromotionType.TERM_ROLLOVER,
      idempotencyKey: 'rollover-2569-term-2',
    });
    expect(captured.createItemsArguments).toBeDefined();
    expect('studentPointAccount' in mock.prisma).toBe(false);
  });

  it('returns an existing batch without opening a transaction', async () => {
    const mock = createPrismaMock();
    mock.promotionBatchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      type: PromotionType.TERM_ROLLOVER,
      sourceTermId: 1,
      targetTermId: 2,
      status: PromotionStatus.APPLIED,
      items: [],
    });
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.applyTermRollover('admin-1', {
      sourceTermId: 1,
      targetTermId: 2,
      idempotencyKey: 'rollover-2569-term-2',
    });

    expect(result.idempotent).toBe(true);
    expect(result.batch.id).toBe('batch-existing');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key that belongs to another request', async () => {
    const mock = createPrismaMock();
    mock.promotionBatchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      type: PromotionType.TERM_ROLLOVER,
      sourceTermId: 99,
      targetTermId: 100,
      status: PromotionStatus.APPLIED,
      items: [],
    });
    const service = new PromotionsService(mock.prisma as never);

    await expect(
      service.applyTermRollover('admin-1', {
        sourceTermId: 1,
        targetTermId: 2,
        idempotencyKey: 'reused-key',
      }),
    ).rejects.toThrow('idempotencyKey นี้ถูกใช้กับคำขออื่นแล้ว');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('blocks apply when enrollment backfill is incomplete', async () => {
    const mock = createPrismaMock();
    mock.prisma.classroom.findMany.mockImplementation(
      ({ where }: { where: { termId: number } }) =>
        Promise.resolve(
          where.termId === 1
            ? [
                {
                  ...sourceRoom,
                  enrollments: [],
                },
              ]
            : [],
        ),
    );
    const service = new PromotionsService(mock.prisma as never);

    await expect(
      service.applyTermRollover('admin-1', {
        sourceTermId: 1,
        targetTermId: 2,
        idempotencyKey: 'rollover-blocked',
      }),
    ).rejects.toThrow('ไม่สามารถเปลี่ยนภาคเรียนได้');
    expect(mock.classroomCreate).not.toHaveBeenCalled();
  });
});

describe('PromotionsService annual promotion', () => {
  const configureNextYear = (mock: ReturnType<typeof createPrismaMock>) => {
    mock.prisma.academicTerm.findUnique.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(
          where.id === 1 ? { ...sourceTerm, term: 2 } : nextYearTerm,
        ),
    );
  };

  it('requires explicit mappings and previews next-year movement', async () => {
    const mock = createPrismaMock();
    configureNextYear(mock);
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.previewAnnualPromotion({
      sourceTermId: 1,
      targetTermId: 3,
      classroomMappings: [
        {
          sourceClassroomId: 10,
          targetName: 'ม.2/1',
          defaultAction: PromotionAction.MOVE,
        },
      ],
    });

    expect(result.summary).toEqual(
      expect.objectContaining({
        classroomsToCreate: 1,
        studentsToMove: 1,
        blockingIssues: 0,
      }),
    );
    expect(result.classrooms[0].targetName).toBe('ม.2/1');
    expect(result.students[0]).toEqual(
      expect.objectContaining({
        studentId: 'student-1',
        firstName: 'สมชาย',
        targetSourceClassroomId: 10,
      }),
    );
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('graduates a class without creating a target room or resetting scores', async () => {
    const mock = createPrismaMock();
    configureNextYear(mock);
    const service = new PromotionsService(mock.prisma as never);

    const result = await service.applyAnnualPromotion('admin-1', {
      sourceTermId: 1,
      targetTermId: 3,
      idempotencyKey: 'annual-2569-to-2570',
      classroomMappings: [
        {
          sourceClassroomId: 10,
          defaultAction: PromotionAction.GRADUATE,
        },
      ],
    });
    const captured = mock.getArguments();
    const closedEnrollment = captured.closeEnrollmentArguments as {
      data: { exitReason: string };
    };
    const updatedUser = captured.updateUserArguments as {
      data: { classroomId: number | null };
    };
    const createdBatch = captured.createBatchArguments as {
      data: { type: PromotionType };
    };

    expect(result.idempotent).toBe(false);
    expect(mock.classroomCreate).not.toHaveBeenCalled();
    expect(closedEnrollment.data.exitReason).toBe('GRADUATED');
    expect(updatedUser.data.classroomId).toBeNull();
    expect(createdBatch.data.type).toBe(PromotionType.ANNUAL_PROMOTION);
    expect('studentPointAccount' in mock.prisma).toBe(false);
  });
});
