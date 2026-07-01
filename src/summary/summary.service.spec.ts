import { PointType } from '@prisma/client';
import { SummaryService } from './summary.service';

describe('SummaryService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    classroom: {
      findMany: jest.fn(),
    },
  };

  const service = new SummaryService(prisma as any);
  const classroom = {
    id: 7,
    name: 'ม.1/1',
    startingPoints: 100,
    failingThreshold: 50,
    certificateThreshold: 80,
    shieldThreshold: 90,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks a score below failingThreshold as FAILED', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student-1',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      classroom,
      behaviorLogs: [
        { points: 51, category: { type: PointType.DEDUCT } },
      ],
    });

    const result = await service.getStudentSummary('student-1');

    expect(result.scoreInfo.currentScore).toBe(49);
    expect(result.scoreInfo.status).toBe('FAILED');
  });

  it('does not fail a score equal to failingThreshold', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student-1',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      classroom,
      behaviorLogs: [
        { points: 50, category: { type: PointType.DEDUCT } },
      ],
    });

    const result = await service.getStudentSummary('student-1');

    expect(result.scoreInfo.currentScore).toBe(50);
    expect(result.scoreInfo.status).toBe('NORMAL');
  });

  it('filters the school-wide summary by term and classroom', async () => {
    prisma.classroom.findMany.mockResolvedValue([]);

    await service.getSchoolWideSummary(3, 7);

    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          termId: 3,
          id: 7,
        },
      }),
    );
  });
});
