import { EnrollmentExitReason, EnrollmentStatus } from '@prisma/client';
import {
  enrollmentDataForContext,
  requireStudentAcademicContexts,
} from './student-academic-context';

describe('student academic context', () => {
  it('returns immutable classroom and term context for every student', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
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
        ]),
      },
    };

    const contexts = await requireStudentAcademicContexts(
      prisma as never,
      ['student-1'],
      2,
    );

    expect(contexts.get('student-1')).toEqual(
      expect.objectContaining({
        classroomId: 10,
        termId: 2,
        startingPoints: 100,
      }),
    );
  });

  it('rejects a student whose room is outside the expected term', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'student-1',
            classroom: {
              id: 10,
              termId: 1,
              startingPoints: 100,
              term: {
                isActive: false,
                startDate: new Date('2026-05-01T00:00:00.000Z'),
                endDate: new Date('2026-10-01T00:00:00.000Z'),
              },
            },
          },
        ]),
      },
    };

    await expect(
      requireStudentAcademicContexts(prisma as never, ['student-1'], 2),
    ).rejects.toThrow('ไม่ได้อยู่ในภาคเรียนปัจจุบัน');
  });

  it('creates an ended enrollment for a non-active term', () => {
    const data = enrollmentDataForContext(
      {
        classroomId: 10,
        termId: 1,
        startingPoints: 100,
        termIsActive: false,
        termStartDate: new Date('2026-05-01T00:00:00.000Z'),
        termEndDate: new Date('2026-10-01T00:00:00.000Z'),
      },
      new Date('2026-06-01T00:00:00.000Z'),
    );

    expect(data).toEqual(
      expect.objectContaining({
        status: EnrollmentStatus.ENDED,
        exitReason: EnrollmentExitReason.TERM_COMPLETED,
        endedAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    );
  });
});
