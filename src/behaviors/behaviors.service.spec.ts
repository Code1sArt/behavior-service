import { PointType, Role } from '@prisma/client';
import { BehaviorsService } from './behaviors.service';

describe('BehaviorsService write snapshots', () => {
  let createBehaviorArguments: unknown;
  const createBehavior = jest.fn((argumentsValue: unknown) => {
    createBehaviorArguments = argumentsValue;
    return Promise.resolve({ id: 'behavior-1' });
  });
  const prisma = {
    pointCategory: {
      findUnique: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    behaviorRecord: {
      create: createBehavior,
      findMany: jest.fn(),
    },
  };
  const service = new BehaviorsService(prisma as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    createBehaviorArguments = undefined;
    prisma.pointCategory.findUnique.mockResolvedValue({
      id: 5,
      type: PointType.DEDUCT,
      defaultPoints: 7,
      allowedForTeacher: true,
      allowedForAffairs: true,
    });
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'student-1',
        classroom: {
          id: 10,
          termId: 2,
          startingPoints: 100,
          term: {
            isActive: true,
            startDate: new Date('2026-11-01T00:00:00.000Z'),
            endDate: new Date('2027-03-31T00:00:00.000Z'),
          },
        },
      },
    ]);
  });

  it('writes signed points, classroom, and term on a new record', async () => {
    await service.create('recorder-1', Role.TEACHER, {
      studentId: 'student-1',
      categoryId: 5,
      note: 'ทดสอบ',
    });

    const call = createBehaviorArguments as {
      data: {
        pointDelta: number;
        classroomId: number;
        termId: number;
      };
    };
    expect(call.data).toMatchObject({
      pointDelta: -7,
      classroomId: 10,
      termId: 2,
    });
  });

  it('filters history by immutable classroom and term snapshots', async () => {
    prisma.behaviorRecord.findMany.mockResolvedValue([
      {
        id: 'behavior-1',
        termId: 2,
        classroomId: 10,
        classroom: { name: 'ม.1/1' },
        student: {
          id: 'student-1',
          citizenId: '10001',
          firstName: 'สมชาย',
          lastName: 'ใจดี',
        },
      },
    ]);

    const result = await service.getBehaviorHistory(
      undefined,
      10,
      undefined,
      2,
    );

    expect(prisma.behaviorRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([{ termId: 2 }, { classroomId: 10 }]),
        },
      }),
    );
    expect(result[0].student.classroom.name).toBe('ม.1/1');
  });
});
