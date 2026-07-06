import { StudentsService } from './students.service';

describe('StudentsService history writes', () => {
  it('creates a point account and enrollment with a new student', async () => {
    let createUserArguments: unknown;
    const createUser = jest.fn((argumentsValue: unknown) => {
      createUserArguments = argumentsValue;
      return Promise.resolve({ id: 'student-1' });
    });
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: createUser,
      },
      classroom: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          termId: 2,
          startingPoints: 100,
          term: {
            isActive: true,
            startDate: new Date('2026-11-01T00:00:00.000Z'),
            endDate: new Date('2027-03-31T00:00:00.000Z'),
          },
        }),
      },
    };
    const service = new StudentsService(prisma as never);

    await service.create({
      citizenId: '10001',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      password: '123456',
      classroomId: 10,
    });

    const call = createUserArguments as {
      data: {
        pointAccount: { create: { initialPoints: number } };
        enrollments: {
          create: {
            classroomId: number;
            termId: number;
            status: string;
          };
        };
      };
    };
    expect(call.data).toMatchObject({
      pointAccount: { create: { initialPoints: 100 } },
      enrollments: {
        create: {
          classroomId: 10,
          termId: 2,
          status: 'ACTIVE',
        },
      },
    });
  });

  it('returns the first 30 students when the search query is empty', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new StudentsService({
      user: { findMany },
    } as never);

    await service.search('', 30);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'STUDENT' },
        take: 30,
      }),
    );
  });

  it('deletes all student-owned records in a transaction before deleting the user', async () => {
    const attendanceDeleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const behaviorDeleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const promotionDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const enrollmentDeleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const pointAccountDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const userDelete = jest.fn().mockResolvedValue({ id: 'student-1' });
    const transactionClient = {
      attendanceRecord: { deleteMany: attendanceDeleteMany },
      behaviorRecord: { deleteMany: behaviorDeleteMany },
      promotionItem: { deleteMany: promotionDeleteMany },
      studentEnrollment: { deleteMany: enrollmentDeleteMany },
      studentPointAccount: { deleteMany: pointAccountDeleteMany },
      user: { delete: userDelete },
    };
    const service = new StudentsService({
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'student-1',
          role: 'STUDENT',
          firstName: 'สมชาย',
          lastName: 'ใจดี',
        }),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
          callback(transactionClient),
      ),
    } as never);

    const result = await service.remove('student-1');

    expect(attendanceDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ studentId: 'student-1' }, { recorderId: 'student-1' }],
      },
    });
    expect(behaviorDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ studentId: 'student-1' }, { recorderId: 'student-1' }],
      },
    });
    expect(promotionDeleteMany).toHaveBeenCalledWith({
      where: { studentId: 'student-1' },
    });
    expect(enrollmentDeleteMany).toHaveBeenCalledWith({
      where: { studentId: 'student-1' },
    });
    expect(pointAccountDeleteMany).toHaveBeenCalledWith({
      where: { studentId: 'student-1' },
    });
    expect(userDelete).toHaveBeenCalledWith({
      where: { id: 'student-1' },
    });
    expect(result).toMatchObject({
      success: true,
      deleted: {
        attendanceRecords: 3,
        behaviorRecords: 2,
        promotionItems: 1,
        enrollments: 2,
        pointAccounts: 1,
      },
    });
  });
});
