import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EnrollmentExitReason,
  EnrollmentStatus,
  PointType,
  Role,
} from '@prisma/client';
import {
  calculateLedgerScore,
  calculateLegacyScore,
} from '../points/score-calculator';
import { PrismaService } from '../prisma/prisma.service';

type ScoreRecord = {
  points: number;
  pointDelta: number | null;
  createdAt: Date;
  category: { type: PointType } | null;
  term?: { endDate: Date } | null;
};

type ScoreStudent = {
  id: string;
  citizenId: string;
  firstName: string;
  lastName: string;
  pointAccount: { initialPoints: number } | null;
  behaviorLogs: ScoreRecord[];
};

type ClassroomThresholds = {
  failingThreshold: number;
  certificateThreshold: number;
  shieldThreshold: number;
};

@Injectable()
export class SummaryService {
  constructor(private prisma: PrismaService) {}

  private isSummaryEligibleEnrollment(enrollment: {
    status: EnrollmentStatus;
    exitReason: EnrollmentExitReason | null;
  }) {
    return (
      enrollment.status === EnrollmentStatus.ACTIVE ||
      (enrollment.status === EnrollmentStatus.ENDED &&
        enrollment.exitReason !== EnrollmentExitReason.TRANSFERRED &&
        enrollment.exitReason !== EnrollmentExitReason.STUDY_LEAVE)
    );
  }

  private summaryEnrollmentWhere(termId?: number) {
    return {
      ...(termId !== undefined && { termId }),
      OR: [
        { status: EnrollmentStatus.ACTIVE },
        {
          status: EnrollmentStatus.ENDED,
          exitReason: {
            notIn: [
              EnrollmentExitReason.TRANSFERRED,
              EnrollmentExitReason.STUDY_LEAVE,
            ],
          },
        },
      ],
    };
  }

  private calculateCumulativeScore(
    student: ScoreStudent,
    fallbackStartingPoints: number,
    through?: Date,
  ) {
    const records = through
      ? student.behaviorLogs.filter(
          (record) =>
            (record.term
              ? this.endOfTerm(record.term.endDate).getTime()
              : record.createdAt.getTime()) <= through.getTime(),
        )
      : student.behaviorLogs;
    const hasCompleteLedger =
      student.pointAccount != null &&
      records.every((record) => typeof record.pointDelta === 'number');

    if (hasCompleteLedger) {
      return calculateLedgerScore(
        student.pointAccount!.initialPoints,
        records.map((record) => record.pointDelta as number),
      );
    }

    return calculateLegacyScore(fallbackStartingPoints, records);
  }

  private determineStatus(score: number, classroom: ClassroomThresholds) {
    if (score < classroom.failingThreshold) return 'FAILED';
    if (score >= classroom.shieldThreshold) return 'SHIELD';
    if (score >= classroom.certificateThreshold) return 'CERTIFICATE';
    return 'NORMAL';
  }

  private endOfTerm(endDate: Date) {
    return new Date(endDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  async getStudentSummary(studentId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      include: {
        classroom: true,
        pointAccount: true,
        behaviorLogs: {
          include: { category: true, term: { select: { endDate: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!student || !student.classroom) {
      throw new NotFoundException('ไม่พบข้อมูลนักเรียนหรือข้อมูลห้องเรียน');
    }

    const currentScore = this.calculateCumulativeScore(
      student,
      student.classroom.startingPoints,
    );

    return {
      studentId: student.id,
      name: `${student.firstName} ${student.lastName}`,
      scoreInfo: {
        currentScore,
        startingPoints:
          student.pointAccount?.initialPoints ??
          student.classroom.startingPoints,
        status: this.determineStatus(currentScore, student.classroom),
      },
      thresholds: {
        failing: student.classroom.failingThreshold,
        certificate: student.classroom.certificateThreshold,
        shield: student.classroom.shieldThreshold,
      },
      history: student.behaviorLogs,
    };
  }

  async getClassroomSummary(classroomId: number) {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classroomId },
      include: {
        term: true,
        enrollments: {
          where: this.summaryEnrollmentWhere(),
          include: {
            student: {
              include: {
                pointAccount: true,
                behaviorLogs: {
                  include: {
                    category: true,
                    term: { select: { endDate: true } },
                  },
                },
              },
            },
          },
        },
        students: {
          where: {
            role: Role.STUDENT,
            enrollments: { none: {} },
          },
          include: {
            pointAccount: true,
            behaviorLogs: {
              include: {
                category: true,
                term: { select: { endDate: true } },
              },
            },
          },
        },
      },
    });

    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');

    const roster = [
      ...classroom.enrollments
        .filter((enrollment) => this.isSummaryEligibleEnrollment(enrollment))
        .map((enrollment) => enrollment.student),
      ...classroom.students,
    ];
    const uniqueStudents = [
      ...new Map(roster.map((student) => [student.id, student])).values(),
    ];
    const through = this.endOfTerm(classroom.term.endDate);
    const studentStats = uniqueStudents.map((student) => {
      const score = this.calculateCumulativeScore(
        student,
        classroom.startingPoints,
        through,
      );
      return {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        score,
        status: this.determineStatus(score, classroom),
      };
    });

    return {
      className: classroom.name,
      thresholds: {
        starting: classroom.startingPoints,
        failing: classroom.failingThreshold,
        certificate: classroom.certificateThreshold,
        shield: classroom.shieldThreshold,
      },
      summary: {
        total: studentStats.length,
        passed: studentStats.filter((student) => student.status !== 'FAILED')
          .length,
        failed: studentStats.filter((student) => student.status === 'FAILED')
          .length,
        shield: studentStats.filter((student) => student.status === 'SHIELD')
          .length,
        certificate: studentStats.filter(
          (student) => student.status === 'CERTIFICATE',
        ).length,
      },
      students: studentStats,
    };
  }

  async getSchoolWideSummary(termId?: number, classroomId?: number) {
    const selectedTermId =
      termId ??
      (
        await this.prisma.academicTerm.findFirst({
          where: { isActive: true },
          select: { id: true },
        })
      )?.id;

    if (!selectedTermId) {
      return this.emptySchoolWideSummary();
    }

    const classrooms = await this.prisma.classroom.findMany({
      where: {
        termId: selectedTermId,
        ...(classroomId !== undefined && { id: classroomId }),
      },
      include: {
        term: true,
        enrollments: {
          where: this.summaryEnrollmentWhere(selectedTermId),
          include: {
            student: {
              include: {
                pointAccount: true,
                behaviorLogs: {
                  include: {
                    category: true,
                    term: { select: { endDate: true } },
                  },
                },
              },
            },
          },
        },
        students: {
          where: {
            role: Role.STUDENT,
            enrollments: { none: {} },
          },
          include: {
            pointAccount: true,
            behaviorLogs: {
              include: {
                category: true,
                term: { select: { endDate: true } },
              },
            },
          },
        },
      },
    });

    const result = this.emptySchoolWideSummary();

    for (const classroom of classrooms) {
      const roster = [
        ...classroom.enrollments
          .filter((enrollment) => this.isSummaryEligibleEnrollment(enrollment))
          .map((enrollment) => enrollment.student),
        ...classroom.students,
      ];
      const uniqueStudents = [
        ...new Map(roster.map((student) => [student.id, student])).values(),
      ];
      const through = this.endOfTerm(classroom.term.endDate);

      for (const student of uniqueStudents) {
        const score = this.calculateCumulativeScore(
          student,
          classroom.startingPoints,
          through,
        );
        const status = this.determineStatus(score, classroom);
        const studentData = {
          id: student.id,
          citizenId: student.citizenId,
          name: `${student.firstName} ${student.lastName}`,
          classroom: classroom.name,
          score,
        };

        result.summary.total++;
        if (status === 'FAILED') {
          result.summary.failedCount++;
          result.lists.failed.push(studentData);
        } else if (status === 'SHIELD') {
          result.summary.shieldCount++;
          result.lists.shield.push(studentData);
        } else if (status === 'CERTIFICATE') {
          result.summary.certificateCount++;
          result.lists.certificate.push(studentData);
        } else {
          result.summary.normalCount++;
          result.lists.normal.push(studentData);
        }
      }
    }

    result.lists.shield.sort((left, right) => right.score - left.score);
    result.lists.certificate.sort((left, right) => right.score - left.score);
    result.lists.normal.sort((left, right) => right.score - left.score);
    result.lists.failed.sort((left, right) => left.score - right.score);
    return result;
  }

  private emptySchoolWideSummary() {
    type StudentData = {
      id: string;
      citizenId: string;
      name: string;
      classroom: string;
      score: number;
    };

    return {
      summary: {
        total: 0,
        failedCount: 0,
        normalCount: 0,
        certificateCount: 0,
        shieldCount: 0,
      },
      lists: {
        failed: [] as StudentData[],
        normal: [] as StudentData[],
        certificate: [] as StudentData[],
        shield: [] as StudentData[],
      },
    };
  }
}
