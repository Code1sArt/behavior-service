import { EnrollmentStatus, PointType } from '@prisma/client';
import {
  buildStudentHistoryBackfillPlan,
  type StudentHistoryBackfillInput,
} from './student-history-backfill';

const term = {
  id: 1,
  startDate: new Date('2026-05-01T00:00:00.000Z'),
  endDate: new Date('2026-10-01T00:00:00.000Z'),
  isActive: true,
};

const input = (): StudentHistoryBackfillInput => ({
  terms: [term],
  students: [
    {
      id: 'student-1',
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      classroom: {
        id: 10,
        startingPoints: 100,
        termId: term.id,
        term,
      },
    },
  ],
  attendanceRecords: [
    {
      id: 'attendance-1',
      termId: term.id,
      classroomId: null,
      student: {
        id: 'student-1',
        classroom: { id: 10, termId: term.id },
      },
    },
  ],
  behaviorRecords: [
    {
      id: 'behavior-1',
      points: 5,
      pointDelta: null,
      classroomId: null,
      termId: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      category: { type: PointType.DEDUCT },
      student: {
        id: 'student-1',
        classroom: { id: 10, termId: term.id },
      },
    },
  ],
  pointAccounts: [],
  enrollments: [],
});

describe('student history backfill planner', () => {
  it('creates additive snapshots without changing score semantics', () => {
    const plan = buildStudentHistoryBackfillPlan(input());

    expect(plan.summary).toEqual(
      expect.objectContaining({
        pointAccountsToCreate: 1,
        enrollmentsToCreate: 1,
        attendanceRecordsToUpdate: 1,
        behaviorRecordsToUpdate: 1,
        blockingIssues: 0,
      }),
    );
    expect(plan.pointAccounts[0]).toEqual({
      studentId: 'student-1',
      initialPoints: 100,
    });
    expect(plan.behaviorUpdates[0]).toEqual({
      id: 'behavior-1',
      classroomId: 10,
      termId: 1,
      pointDelta: -5,
    });
  });

  it('is idempotent when all target data already exists', () => {
    const existing = input();
    existing.pointAccounts = [{ studentId: 'student-1', initialPoints: 100 }];
    existing.enrollments = [
      {
        studentId: 'student-1',
        classroomId: 10,
        termId: 1,
        status: EnrollmentStatus.ACTIVE,
      },
    ];
    existing.attendanceRecords[0].classroomId = 10;
    existing.behaviorRecords[0] = {
      ...existing.behaviorRecords[0],
      classroomId: 10,
      termId: 1,
      pointDelta: -5,
    };

    const plan = buildStudentHistoryBackfillPlan(existing);

    expect(plan.summary).toEqual(
      expect.objectContaining({
        pointAccountsToCreate: 0,
        enrollmentsToCreate: 0,
        attendanceRecordsToUpdate: 0,
        behaviorRecordsToUpdate: 0,
        blockingIssues: 0,
      }),
    );
  });

  it('blocks records whose historical classroom cannot be inferred safely', () => {
    const mismatch = input();
    mismatch.attendanceRecords[0].termId = 2;
    mismatch.behaviorRecords[0].createdAt = new Date(
      '2025-01-01T00:00:00.000Z',
    );

    const plan = buildStudentHistoryBackfillPlan(mismatch);

    expect(plan.summary.blockingIssues).toBe(2);
    expect(plan.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'ATTENDANCE_TERM_CLASSROOM_MISMATCH',
        'BEHAVIOR_TERM_NOT_FOUND',
      ]),
    );
    expect(plan.attendanceUpdates).toHaveLength(0);
    expect(plan.behaviorUpdates).toHaveLength(0);
  });

  it('never overwrites conflicting snapshots', () => {
    const conflict = input();
    conflict.attendanceRecords[0].classroomId = 99;
    conflict.behaviorRecords[0] = {
      ...conflict.behaviorRecords[0],
      classroomId: 99,
      termId: 2,
      pointDelta: 5,
    };

    const plan = buildStudentHistoryBackfillPlan(conflict);

    expect(plan.summary.blockingIssues).toBe(4);
    expect(plan.attendanceUpdates).toHaveLength(0);
    expect(plan.behaviorUpdates).toHaveLength(0);
  });
});
