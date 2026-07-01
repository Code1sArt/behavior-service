import { PointType } from '@prisma/client';
import {
  verifyStudentScores,
  type ScoreVerificationStudent,
} from './student-score-verification';

const student = (): ScoreVerificationStudent => ({
  id: 'student-1',
  classroom: { startingPoints: 100 },
  pointAccount: { initialPoints: 100 },
  behaviorLogs: [
    {
      id: 'behavior-add',
      points: 10,
      pointDelta: 10,
      category: { type: PointType.ADD },
    },
    {
      id: 'behavior-deduct',
      points: 5,
      pointDelta: -5,
      category: { type: PointType.DEDUCT },
    },
    {
      id: 'behavior-auto-deduct',
      points: 2,
      pointDelta: -2,
      category: null,
    },
  ],
});

describe('student score verification', () => {
  it('matches the cumulative ledger to the legacy score', () => {
    const report = verifyStudentScores([student()]);

    expect(report.summary).toEqual({
      students: 1,
      matchedStudents: 1,
      blockingIssues: 0,
    });
    expect(report.issues).toEqual([]);
  });

  it('reports a missing point account', () => {
    const missingAccount = student();
    missingAccount.pointAccount = null;

    const report = verifyStudentScores([missingAccount]);

    expect(report.issues[0].code).toBe('MISSING_POINT_ACCOUNT');
    expect(report.summary.matchedStudents).toBe(0);
  });

  it('reports every behavior record without pointDelta', () => {
    const missingDelta = student();
    missingDelta.behaviorLogs[0].pointDelta = null;
    missingDelta.behaviorLogs[2].pointDelta = null;

    const report = verifyStudentScores([missingDelta]);

    expect(report.issues[0]).toEqual(
      expect.objectContaining({
        code: 'MISSING_POINT_DELTA',
        behaviorRecordIds: ['behavior-add', 'behavior-auto-deduct'],
      }),
    );
  });

  it('reports the exact score difference', () => {
    const mismatch = student();
    mismatch.pointAccount = { initialPoints: 90 };

    const report = verifyStudentScores([mismatch]);

    expect(report.issues[0]).toEqual(
      expect.objectContaining({
        code: 'SCORE_MISMATCH',
        legacyScore: 103,
        ledgerScore: 93,
        difference: -10,
      }),
    );
  });
});
