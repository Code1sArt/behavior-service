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
});
