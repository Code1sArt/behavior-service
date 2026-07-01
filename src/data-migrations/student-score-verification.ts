import { PointType } from '@prisma/client';
import {
  calculateLedgerScore,
  calculateLegacyScore,
} from '../points/score-calculator';

export interface ScoreVerificationStudent {
  id: string;
  classroom: {
    startingPoints: number;
  } | null;
  pointAccount: {
    initialPoints: number;
  } | null;
  behaviorLogs: Array<{
    id: string;
    points: number;
    pointDelta: number | null;
    category: {
      type: PointType;
    } | null;
  }>;
}

export interface ScoreVerificationIssue {
  studentId: string;
  code:
    | 'MISSING_CLASSROOM'
    | 'MISSING_POINT_ACCOUNT'
    | 'MISSING_POINT_DELTA'
    | 'SCORE_MISMATCH';
  message: string;
  behaviorRecordIds?: string[];
  legacyScore?: number;
  ledgerScore?: number;
  difference?: number;
}

export interface ScoreVerificationReport {
  summary: {
    students: number;
    matchedStudents: number;
    blockingIssues: number;
  };
  issues: ScoreVerificationIssue[];
}

export function verifyStudentScores(
  students: ScoreVerificationStudent[],
): ScoreVerificationReport {
  const issues: ScoreVerificationIssue[] = [];
  let matchedStudents = 0;

  for (const student of students) {
    if (!student.classroom) {
      issues.push({
        studentId: student.id,
        code: 'MISSING_CLASSROOM',
        message: 'ไม่สามารถคำนวณคะแนนแบบเดิมได้ เพราะนักเรียนไม่มีห้องปัจจุบัน',
      });
      continue;
    }
    if (!student.pointAccount) {
      issues.push({
        studentId: student.id,
        code: 'MISSING_POINT_ACCOUNT',
        message: 'ยังไม่มีบัญชีคะแนนตั้งต้นของนักเรียน',
      });
      continue;
    }

    const recordsWithoutDelta = student.behaviorLogs.filter(
      (record) => record.pointDelta === null,
    );
    if (recordsWithoutDelta.length > 0) {
      issues.push({
        studentId: student.id,
        code: 'MISSING_POINT_DELTA',
        message: 'ยังมีประวัติพฤติกรรมที่ไม่มี pointDelta',
        behaviorRecordIds: recordsWithoutDelta.map((record) => record.id),
      });
      continue;
    }

    const legacyScore = calculateLegacyScore(
      student.classroom.startingPoints,
      student.behaviorLogs,
    );
    const ledgerScore = calculateLedgerScore(
      student.pointAccount.initialPoints,
      student.behaviorLogs.map((record) => record.pointDelta as number),
    );

    if (legacyScore !== ledgerScore) {
      issues.push({
        studentId: student.id,
        code: 'SCORE_MISMATCH',
        message: 'คะแนนสะสมจากสูตรใหม่ไม่ตรงกับสูตรเดิม',
        legacyScore,
        ledgerScore,
        difference: ledgerScore - legacyScore,
      });
      continue;
    }

    matchedStudents++;
  }

  return {
    summary: {
      students: students.length,
      matchedStudents,
      blockingIssues: issues.length,
    },
    issues,
  };
}
