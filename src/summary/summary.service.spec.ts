import {
  EnrollmentExitReason,
  EnrollmentStatus,
  PointType,
} from '@prisma/client';
import { SummaryService } from './summary.service';

describe('SummaryService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    classroom: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    academicTerm: {
      findFirst: jest.fn(),
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
      behaviorLogs: [{ points: 51, category: { type: PointType.DEDUCT } }],
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
      behaviorLogs: [{ points: 50, category: { type: PointType.DEDUCT } }],
    });

    const result = await service.getStudentSummary('student-1');

    expect(result.scoreInfo.currentScore).toBe(50);
    expect(result.scoreInfo.status).toBe('NORMAL');
  });

  it('uses the cumulative point ledger when backfill is complete', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student-1',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      classroom,
      pointAccount: { initialPoints: 100 },
      behaviorLogs: [
        {
          points: 10,
          pointDelta: -10,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          category: { type: PointType.ADD },
        },
      ],
    });

    const result = await service.getStudentSummary('student-1');

    expect(result.scoreInfo.currentScore).toBe(90);
    expect(result.scoreInfo.startingPoints).toBe(100);
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

  it('uses enrollment history as the roster for an old term', async () => {
    prisma.classroom.findMany.mockResolvedValue([
      {
        ...classroom,
        term: { endDate: new Date('2026-10-01T00:00:00.000Z') },
        students: [],
        enrollments: [
          {
            status: EnrollmentStatus.ENDED,
            exitReason: EnrollmentExitReason.TERM_COMPLETED,
            student: {
              id: 'student-1',
              citizenId: '10001',
              firstName: 'สมชาย',
              lastName: 'ใจดี',
              pointAccount: { initialPoints: 100 },
              behaviorLogs: [
                {
                  points: 5,
                  pointDelta: -5,
                  createdAt: new Date('2027-01-01T00:00:00.000Z'),
                  term: {
                    endDate: new Date('2026-10-01T00:00:00.000Z'),
                  },
                  category: { type: PointType.DEDUCT },
                },
              ],
            },
          },
        ],
      },
    ]);

    const result = await service.getSchoolWideSummary(1);

    expect(result.summary.total).toBe(1);
    expect(result.lists.shield[0]).toEqual(
      expect.objectContaining({
        id: 'student-1',
        classroom: 'ม.1/1',
        score: 95,
      }),
    );
  });

  it('excludes transferred and study-leave students from school totals', async () => {
    const makeEnrollment = (id: string, exitReason: EnrollmentExitReason) => ({
      status: EnrollmentStatus.ENDED,
      exitReason,
      student: {
        id,
        citizenId: id,
        firstName: id,
        lastName: 'student',
        pointAccount: { initialPoints: 100 },
        behaviorLogs: [],
      },
    });
    prisma.classroom.findMany.mockResolvedValue([
      {
        ...classroom,
        term: { endDate: new Date('2026-10-01T00:00:00.000Z') },
        students: [],
        enrollments: [
          makeEnrollment(
            'student-transferred',
            EnrollmentExitReason.TRANSFERRED,
          ),
          makeEnrollment(
            'student-study-leave',
            EnrollmentExitReason.STUDY_LEAVE,
          ),
          makeEnrollment(
            'student-completed',
            EnrollmentExitReason.TERM_COMPLETED,
          ),
        ],
      },
    ]);

    const result = await service.getSchoolWideSummary(1);

    expect(result.summary.total).toBe(1);
    expect(result.lists.shield.map((student) => student.id)).toEqual([
      'student-completed',
    ]);
  });
});
