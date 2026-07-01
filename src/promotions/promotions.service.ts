import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentExitReason,
  EnrollmentStatus,
  Prisma,
  PromotionAction,
  PromotionStatus,
  PromotionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplyAnnualPromotionDto,
  PreviewAnnualPromotionDto,
} from './dto/annual-promotion.dto';
import {
  ApplyTermRolloverDto,
  PreviewTermRolloverDto,
} from './dto/term-rollover.dto';

const rolloverRoomInclude = Prisma.validator<Prisma.ClassroomInclude>()({
  advisors: { select: { id: true } },
  students: {
    where: { role: 'STUDENT' },
    select: { id: true },
  },
  enrollments: {
    where: { status: EnrollmentStatus.ACTIVE },
    select: {
      id: true,
      studentId: true,
      student: {
        select: {
          id: true,
          citizenId: true,
          firstName: true,
          lastName: true,
          classroomId: true,
        },
      },
    },
  },
  _count: {
    select: {
      enrollments: true,
      attendanceRecords: true,
      behaviorRecords: true,
    },
  },
});

type RolloverRoom = Prisma.ClassroomGetPayload<{
  include: typeof rolloverRoomInclude;
}>;

type RolloverClient = Pick<
  Prisma.TransactionClient,
  'academicTerm' | 'classroom' | 'promotionBatch' | 'studentEnrollment'
>;

export interface RolloverIssue {
  code: string;
  message: string;
  entityId?: string | number;
}

interface PlannedRoom {
  source: RolloverRoom;
  targetName: string | null;
  existingTarget: RolloverRoom | null;
}

export interface PlannedStudent {
  studentId: string;
  citizenId: string;
  firstName: string;
  lastName: string;
  sourceClassroomId: number;
  targetSourceClassroomId: number | null;
  action: PromotionAction;
}

interface RolloverPlan {
  sourceTerm: {
    id: number;
    term: number;
    year: number;
    startDate: Date;
    endDate: Date;
  };
  targetTerm: {
    id: number;
    term: number;
    year: number;
    startDate: Date;
    endDate: Date;
  };
  rooms: PlannedRoom[];
  students: PlannedStudent[];
  issues: RolloverIssue[];
}

@Injectable()
export class PromotionsService {
  constructor(private prisma: PrismaService) {}

  async previewTermRollover(dto: PreviewTermRolloverDto) {
    const existingBatch = await this.findExistingRollover(
      this.prisma,
      dto.sourceTermId,
      dto.targetTermId,
    );
    const plan = await this.buildTermRolloverPlan(this.prisma, dto);
    if (existingBatch) {
      plan.issues.push({
        code: 'ROLLOVER_ALREADY_APPLIED',
        message: 'ภาคเรียนคู่นี้มีการ Apply ไปแล้ว',
        entityId: existingBatch.id,
      });
    }

    return {
      sourceTerm: plan.sourceTerm,
      targetTerm: plan.targetTerm,
      summary: {
        classrooms: plan.rooms.length,
        classroomsToCreate: plan.rooms.filter((room) => !room.existingTarget)
          .length,
        classroomsToReuse: plan.rooms.filter((room) => room.existingTarget)
          .length,
        students: plan.students.length,
        studentsToMove: plan.students.filter(
          (student) => student.action === PromotionAction.MOVE,
        ).length,
        studentsToTransferOut: plan.students.filter(
          (student) => student.action === PromotionAction.TRANSFER_OUT,
        ).length,
        studentsToSkip: plan.students.filter(
          (student) => student.action === PromotionAction.SKIP,
        ).length,
        blockingIssues: plan.issues.length,
      },
      classrooms: plan.rooms.map((room) => ({
        sourceClassroomId: room.source.id,
        sourceName: room.source.name,
        targetName: room.targetName,
        targetClassroomId: room.existingTarget?.id ?? null,
        willCreate: !room.existingTarget,
        studentCount: room.source.enrollments.length,
      })),
      students: plan.students,
      issues: plan.issues,
    };
  }

  async previewAnnualPromotion(dto: PreviewAnnualPromotionDto) {
    const existingBatch = await this.findExistingAnnualPromotion(
      this.prisma,
      dto.sourceTermId,
      dto.targetTermId,
    );
    const plan = await this.buildAnnualPromotionPlan(this.prisma, dto);
    if (existingBatch) {
      plan.issues.push({
        code: 'ANNUAL_PROMOTION_ALREADY_APPLIED',
        message: 'ปีการศึกษาคู่นี้มีการ Apply เลื่อนชั้นไปแล้ว',
        entityId: existingBatch.id,
      });
    }

    return {
      sourceTerm: plan.sourceTerm,
      targetTerm: plan.targetTerm,
      summary: {
        classroomMappings: plan.rooms.length,
        classroomsToCreate: plan.rooms.filter(
          (room) => room.targetName !== null && !room.existingTarget,
        ).length,
        classroomsToReuse: plan.rooms.filter(
          (room) => room.targetName !== null && room.existingTarget,
        ).length,
        students: plan.students.length,
        studentsToMove: plan.students.filter(
          (student) => student.action === PromotionAction.MOVE,
        ).length,
        studentsToRepeat: plan.students.filter(
          (student) => student.action === PromotionAction.REPEAT,
        ).length,
        studentsToGraduate: plan.students.filter(
          (student) => student.action === PromotionAction.GRADUATE,
        ).length,
        studentsToTransferOut: plan.students.filter(
          (student) => student.action === PromotionAction.TRANSFER_OUT,
        ).length,
        studentsToSkip: plan.students.filter(
          (student) => student.action === PromotionAction.SKIP,
        ).length,
        blockingIssues: plan.issues.length,
      },
      classrooms: plan.rooms.map((room) => ({
        sourceClassroomId: room.source.id,
        sourceName: room.source.name,
        targetName: room.targetName,
        targetClassroomId: room.existingTarget?.id ?? null,
        willCreate: room.targetName !== null && room.existingTarget === null,
        studentCount: room.source.enrollments.length,
      })),
      students: plan.students,
      issues: plan.issues,
    };
  }

  async applyAnnualPromotion(adminId: string, dto: ApplyAnnualPromotionDto) {
    const existingByKey = await this.prisma.promotionBatch.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { items: true },
    });
    if (existingByKey) {
      this.assertIdempotencyMatches(
        existingByKey,
        PromotionType.ANNUAL_PROMOTION,
        dto.sourceTermId,
        dto.targetTermId,
      );
      return { idempotent: true, batch: existingByKey };
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existingPromotion = await this.findExistingAnnualPromotion(
            tx,
            dto.sourceTermId,
            dto.targetTermId,
          );
          if (existingPromotion) {
            return { idempotent: true, batch: existingPromotion };
          }

          const plan = await this.buildAnnualPromotionPlan(tx, dto);
          if (plan.issues.length > 0) {
            throw new BadRequestException({
              message: 'ไม่สามารถเลื่อนชั้นประจำปีได้',
              issues: plan.issues,
            });
          }

          return this.executePromotionPlan(
            tx,
            adminId,
            dto.idempotencyKey,
            dto.activateTargetTerm !== false,
            PromotionType.ANNUAL_PROMOTION,
            plan,
          );
        },
        { maxWait: 10_000, timeout: 300_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingByIdempotencyKey =
          await this.prisma.promotionBatch.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { items: true },
          });
        if (existingByIdempotencyKey) {
          this.assertIdempotencyMatches(
            existingByIdempotencyKey,
            PromotionType.ANNUAL_PROMOTION,
            dto.sourceTermId,
            dto.targetTermId,
          );
          return { idempotent: true, batch: existingByIdempotencyKey };
        }
        const existingPromotion = await this.findExistingAnnualPromotion(
          this.prisma,
          dto.sourceTermId,
          dto.targetTermId,
        );
        if (existingPromotion) {
          return { idempotent: true, batch: existingPromotion };
        }
      }
      throw error;
    }
  }

  async applyTermRollover(adminId: string, dto: ApplyTermRolloverDto) {
    const existingByKey = await this.prisma.promotionBatch.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { items: true },
    });
    if (existingByKey) {
      this.assertIdempotencyMatches(
        existingByKey,
        PromotionType.TERM_ROLLOVER,
        dto.sourceTermId,
        dto.targetTermId,
      );
      return { idempotent: true, batch: existingByKey };
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existingRollover = await this.findExistingRollover(
            tx,
            dto.sourceTermId,
            dto.targetTermId,
          );
          if (existingRollover) {
            return { idempotent: true, batch: existingRollover };
          }

          const plan = await this.buildTermRolloverPlan(tx, dto);
          if (plan.issues.length > 0) {
            throw new BadRequestException({
              message: 'ไม่สามารถเปลี่ยนภาคเรียนได้',
              issues: plan.issues,
            });
          }

          return this.executePromotionPlan(
            tx,
            adminId,
            dto.idempotencyKey,
            dto.activateTargetTerm !== false,
            PromotionType.TERM_ROLLOVER,
            plan,
          );
        },
        { maxWait: 10_000, timeout: 300_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingByIdempotencyKey =
          await this.prisma.promotionBatch.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: { items: true },
          });
        if (existingByIdempotencyKey) {
          this.assertIdempotencyMatches(
            existingByIdempotencyKey,
            PromotionType.TERM_ROLLOVER,
            dto.sourceTermId,
            dto.targetTermId,
          );
          return { idempotent: true, batch: existingByIdempotencyKey };
        }
        const existingRollover = await this.findExistingRollover(
          this.prisma,
          dto.sourceTermId,
          dto.targetTermId,
        );
        if (existingRollover) {
          return { idempotent: true, batch: existingRollover };
        }
      }
      throw error;
    }
  }

  private async executePromotionPlan(
    tx: Prisma.TransactionClient,
    adminId: string,
    idempotencyKey: string,
    activateTargetTerm: boolean,
    type: PromotionType,
    plan: RolloverPlan,
  ) {
    const batch = await tx.promotionBatch.create({
      data: {
        idempotencyKey,
        type,
        status: PromotionStatus.DRAFT,
        sourceTermId: plan.sourceTerm.id,
        targetTermId: plan.targetTerm.id,
        createdById: adminId,
      },
    });

    const targetClassroomBySourceId = new Map<number, number>();
    for (const room of plan.rooms) {
      if (room.targetName === null) continue;

      const target = room.existingTarget
        ? await tx.classroom.update({
            where: { id: room.existingTarget.id },
            data: {
              startingPoints: room.source.startingPoints,
              failingThreshold: room.source.failingThreshold,
              certificateThreshold: room.source.certificateThreshold,
              shieldThreshold: room.source.shieldThreshold,
              advisors: {
                set: room.source.advisors.map((advisor) => ({
                  id: advisor.id,
                })),
              },
            },
          })
        : await tx.classroom.create({
            data: {
              name: room.targetName,
              startingPoints: room.source.startingPoints,
              failingThreshold: room.source.failingThreshold,
              certificateThreshold: room.source.certificateThreshold,
              shieldThreshold: room.source.shieldThreshold,
              termId: plan.targetTerm.id,
              advisors: {
                connect: room.source.advisors.map((advisor) => ({
                  id: advisor.id,
                })),
              },
            },
          });
      targetClassroomBySourceId.set(room.source.id, target.id);
    }

    const itemData: Prisma.PromotionItemCreateManyInput[] = [];
    for (const student of plan.students) {
      let targetClassroomId: number | null = null;

      if (student.action !== PromotionAction.SKIP) {
        const closed = await tx.studentEnrollment.updateMany({
          where: {
            studentId: student.studentId,
            classroomId: student.sourceClassroomId,
            termId: plan.sourceTerm.id,
            status: EnrollmentStatus.ACTIVE,
          },
          data: {
            status: EnrollmentStatus.ENDED,
            exitReason: this.exitReasonFor(type, student.action),
            endedAt: plan.sourceTerm.endDate,
          },
        });
        if (closed.count !== 1) {
          throw new ConflictException(
            `Enrollment ของนักเรียน ${student.studentId} เปลี่ยนไประหว่าง Apply`,
          );
        }
      }

      if (
        student.action === PromotionAction.MOVE ||
        student.action === PromotionAction.REPEAT
      ) {
        targetClassroomId =
          targetClassroomBySourceId.get(
            student.targetSourceClassroomId as number,
          ) ?? null;
        if (targetClassroomId === null) {
          throw new ConflictException(
            `ไม่พบห้องปลายทางของนักเรียน ${student.studentId}`,
          );
        }
        await tx.studentEnrollment.create({
          data: {
            studentId: student.studentId,
            classroomId: targetClassroomId,
            termId: plan.targetTerm.id,
            status: EnrollmentStatus.ACTIVE,
            startedAt: plan.targetTerm.startDate,
          },
        });
        await tx.user.update({
          where: { id: student.studentId },
          data: { classroomId: targetClassroomId },
        });
      } else if (
        student.action === PromotionAction.TRANSFER_OUT ||
        student.action === PromotionAction.GRADUATE
      ) {
        await tx.user.update({
          where: { id: student.studentId },
          data: { classroomId: null },
        });
      }

      itemData.push({
        batchId: batch.id,
        studentId: student.studentId,
        sourceClassroomId: student.sourceClassroomId,
        targetClassroomId,
        action: student.action,
      });
    }

    if (itemData.length > 0) {
      await tx.promotionItem.createMany({ data: itemData });
    }

    if (activateTargetTerm) {
      await tx.academicTerm.updateMany({
        where: { isActive: true, id: { not: plan.targetTerm.id } },
        data: { isActive: false },
      });
      await tx.academicTerm.update({
        where: { id: plan.targetTerm.id },
        data: { isActive: true },
      });
    }

    const appliedBatch = await tx.promotionBatch.update({
      where: { id: batch.id },
      data: {
        status: PromotionStatus.APPLIED,
        appliedById: adminId,
        appliedAt: new Date(),
      },
      include: {
        items: {
          include: {
            sourceClassroom: { select: { id: true, name: true } },
            targetClassroom: { select: { id: true, name: true } },
          },
        },
      },
    });

    return { idempotent: false, batch: appliedBatch };
  }

  private exitReasonFor(type: PromotionType, action: PromotionAction) {
    if (action === PromotionAction.TRANSFER_OUT) {
      return EnrollmentExitReason.TRANSFERRED;
    }
    if (action === PromotionAction.GRADUATE) {
      return EnrollmentExitReason.GRADUATED;
    }
    if (action === PromotionAction.REPEAT) {
      return EnrollmentExitReason.REPEATED;
    }
    return type === PromotionType.TERM_ROLLOVER
      ? EnrollmentExitReason.TERM_COMPLETED
      : EnrollmentExitReason.PROMOTED;
  }

  private assertIdempotencyMatches(
    batch: {
      type: PromotionType;
      sourceTermId: number;
      targetTermId: number;
    },
    type: PromotionType,
    sourceTermId: number,
    targetTermId: number,
  ) {
    if (
      batch.type !== type ||
      batch.sourceTermId !== sourceTermId ||
      batch.targetTermId !== targetTermId
    ) {
      throw new ConflictException('idempotencyKey นี้ถูกใช้กับคำขออื่นแล้ว');
    }
  }

  private findExistingRollover(
    prisma: RolloverClient,
    sourceTermId: number,
    targetTermId: number,
  ) {
    return prisma.promotionBatch.findUnique({
      where: {
        type_sourceTermId_targetTermId: {
          type: PromotionType.TERM_ROLLOVER,
          sourceTermId,
          targetTermId,
        },
      },
      include: { items: true },
    });
  }

  private findExistingAnnualPromotion(
    prisma: RolloverClient,
    sourceTermId: number,
    targetTermId: number,
  ) {
    return prisma.promotionBatch.findUnique({
      where: {
        type_sourceTermId_targetTermId: {
          type: PromotionType.ANNUAL_PROMOTION,
          sourceTermId,
          targetTermId,
        },
      },
      include: { items: true },
    });
  }

  private async buildAnnualPromotionPlan(
    prisma: RolloverClient,
    dto: PreviewAnnualPromotionDto,
  ): Promise<RolloverPlan> {
    if (dto.sourceTermId === dto.targetTermId) {
      throw new BadRequestException('ภาคเรียนต้นทางและปลายทางต้องไม่ซ้ำกัน');
    }

    const [sourceTerm, targetTerm] = await Promise.all([
      prisma.academicTerm.findUnique({ where: { id: dto.sourceTermId } }),
      prisma.academicTerm.findUnique({ where: { id: dto.targetTermId } }),
    ]);
    if (!sourceTerm) {
      throw new NotFoundException(
        `ไม่พบภาคเรียนต้นทาง ID: ${dto.sourceTermId}`,
      );
    }
    if (!targetTerm) {
      throw new NotFoundException(
        `ไม่พบภาคเรียนปลายทาง ID: ${dto.targetTermId}`,
      );
    }
    if (targetTerm.year !== sourceTerm.year + 1 || targetTerm.term !== 1) {
      throw new BadRequestException(
        'การเลื่อนชั้นประจำปีต้องไปยังภาคเรียน 1 ของปีการศึกษาถัดไป',
      );
    }

    const [sourceRooms, targetRooms] = await Promise.all([
      prisma.classroom.findMany({
        where: { termId: sourceTerm.id },
        include: rolloverRoomInclude,
        orderBy: { name: 'asc' },
      }),
      prisma.classroom.findMany({
        where: { termId: targetTerm.id },
        include: rolloverRoomInclude,
        orderBy: { name: 'asc' },
      }),
    ]);
    const issues: RolloverIssue[] = [];
    if (sourceRooms.length === 0) {
      issues.push({
        code: 'SOURCE_HAS_NO_CLASSROOMS',
        message: 'ภาคเรียนต้นทางไม่มีห้องเรียน',
      });
    }

    const sourceRoomById = new Map(sourceRooms.map((room) => [room.id, room]));
    const mappingBySourceId = new Map<
      number,
      {
        targetName: string | null;
        defaultAction: PromotionAction;
      }
    >();
    const allowedDefaultActions = new Set<PromotionAction>([
      PromotionAction.MOVE,
      PromotionAction.REPEAT,
      PromotionAction.GRADUATE,
      PromotionAction.TRANSFER_OUT,
      PromotionAction.SKIP,
    ]);

    for (const mapping of dto.classroomMappings) {
      if (mappingBySourceId.has(mapping.sourceClassroomId)) {
        issues.push({
          code: 'DUPLICATE_CLASSROOM_MAPPING',
          message: 'ระบุ mapping ของห้องต้นทางซ้ำ',
          entityId: mapping.sourceClassroomId,
        });
        continue;
      }
      if (!sourceRoomById.has(mapping.sourceClassroomId)) {
        issues.push({
          code: 'UNKNOWN_SOURCE_CLASSROOM',
          message: 'ห้องที่ระบุไม่ได้อยู่ในภาคเรียนต้นทาง',
          entityId: mapping.sourceClassroomId,
        });
        continue;
      }
      if (!allowedDefaultActions.has(mapping.defaultAction)) {
        issues.push({
          code: 'UNSUPPORTED_ANNUAL_DEFAULT_ACTION',
          message: 'defaultAction ไม่รองรับในระบบเลื่อนชั้นประจำปี',
          entityId: mapping.sourceClassroomId,
        });
        continue;
      }
      const targetName = mapping.targetName?.trim() || null;
      if (
        (mapping.defaultAction === PromotionAction.MOVE ||
          mapping.defaultAction === PromotionAction.REPEAT) &&
        targetName === null
      ) {
        issues.push({
          code: 'TARGET_NAME_REQUIRED',
          message: 'ห้องที่ MOVE หรือ REPEAT ต้องระบุชื่อห้องปลายทาง',
          entityId: mapping.sourceClassroomId,
        });
      }
      mappingBySourceId.set(mapping.sourceClassroomId, {
        targetName,
        defaultAction: mapping.defaultAction,
      });
    }

    for (const room of sourceRooms) {
      if (!mappingBySourceId.has(room.id)) {
        issues.push({
          code: 'MISSING_CLASSROOM_MAPPING',
          message: `ยังไม่ได้กำหนดการเลื่อนชั้นของห้อง "${room.name}"`,
          entityId: room.id,
        });
      }
    }

    const targetRoomsByName = new Map<string, RolloverRoom[]>();
    for (const room of targetRooms) {
      const matches = targetRoomsByName.get(room.name) ?? [];
      matches.push(room);
      targetRoomsByName.set(room.name, matches);
    }

    const rooms: PlannedRoom[] = sourceRooms.map((source) => {
      const mapping = mappingBySourceId.get(source.id);
      const targetName = mapping?.targetName ?? null;
      const matches =
        targetName === null ? [] : (targetRoomsByName.get(targetName) ?? []);
      if (matches.length > 1) {
        issues.push({
          code: 'DUPLICATE_TARGET_CLASSROOM_NAME',
          message: `มีห้องปลายทางชื่อ "${targetName}" มากกว่าหนึ่งห้อง`,
          entityId: source.id,
        });
      }
      const existingTarget = matches[0] ?? null;
      if (
        existingTarget &&
        (existingTarget.students.length > 0 ||
          existingTarget._count.enrollments > 0 ||
          existingTarget._count.attendanceRecords > 0 ||
          existingTarget._count.behaviorRecords > 0)
      ) {
        issues.push({
          code: 'TARGET_CLASSROOM_NOT_EMPTY',
          message: `ห้องปลายทาง "${targetName}" มีข้อมูลอยู่แล้ว`,
          entityId: existingTarget.id,
        });
      }
      return { source, targetName, existingTarget };
    });

    const targetNameCounts = new Map<string, number>();
    for (const room of rooms) {
      if (room.targetName === null) continue;
      targetNameCounts.set(
        room.targetName,
        (targetNameCounts.get(room.targetName) ?? 0) + 1,
      );
    }
    for (const [name, count] of targetNameCounts) {
      if (count > 1) {
        issues.push({
          code: 'MAPPINGS_SHARE_TARGET_NAME',
          message: `ห้องต้นทางหลายห้องถูกจับคู่ไปยังชื่อ "${name}"`,
        });
      }
    }

    const rosterStudentIds = new Set<string>();
    for (const room of sourceRooms) {
      const enrollmentIds = new Set(
        room.enrollments.map((enrollment) => enrollment.studentId),
      );
      const currentStudentIds = new Set(
        room.students.map((student) => student.id),
      );
      const rosterMatches =
        enrollmentIds.size === currentStudentIds.size &&
        [...enrollmentIds].every((id) => currentStudentIds.has(id));
      if (!rosterMatches) {
        issues.push({
          code: 'SOURCE_ROSTER_NOT_BACKFILLED',
          message: `Enrollment ของห้อง "${room.name}" ไม่ตรงกับห้องปัจจุบัน`,
          entityId: room.id,
        });
      }
      for (const enrollment of room.enrollments) {
        if (rosterStudentIds.has(enrollment.studentId)) {
          issues.push({
            code: 'DUPLICATE_ACTIVE_ENROLLMENT',
            message: 'นักเรียนมี ACTIVE Enrollment ซ้ำในภาคเรียนต้นทาง',
            entityId: enrollment.studentId,
          });
        }
        rosterStudentIds.add(enrollment.studentId);
        if (enrollment.student.classroomId !== room.id) {
          issues.push({
            code: 'CURRENT_CLASSROOM_MISMATCH',
            message: 'ห้องปัจจุบันของนักเรียนไม่ตรงกับ Enrollment',
            entityId: enrollment.studentId,
          });
        }
      }
    }

    if (rosterStudentIds.size > 0) {
      const activeEnrollments = await prisma.studentEnrollment.findMany({
        where: {
          studentId: { in: [...rosterStudentIds] },
          status: EnrollmentStatus.ACTIVE,
        },
        select: { studentId: true },
      });
      const activeCountByStudent = new Map<string, number>();
      for (const enrollment of activeEnrollments) {
        activeCountByStudent.set(
          enrollment.studentId,
          (activeCountByStudent.get(enrollment.studentId) ?? 0) + 1,
        );
      }
      for (const studentId of rosterStudentIds) {
        if (activeCountByStudent.get(studentId) !== 1) {
          issues.push({
            code: 'INVALID_ACTIVE_ENROLLMENT_COUNT',
            message: 'นักเรียนต้องมี ACTIVE Enrollment เพียงหนึ่งรายการ',
            entityId: studentId,
          });
        }
      }
    }

    const overrides = new Map<
      string,
      {
        action: PromotionAction;
        targetSourceClassroomId?: number;
      }
    >();
    for (const override of dto.studentOverrides ?? []) {
      if (overrides.has(override.studentId)) {
        issues.push({
          code: 'DUPLICATE_STUDENT_OVERRIDE',
          message: 'ระบุข้อยกเว้นของนักเรียนซ้ำ',
          entityId: override.studentId,
        });
        continue;
      }
      if (!rosterStudentIds.has(override.studentId)) {
        issues.push({
          code: 'UNKNOWN_STUDENT_OVERRIDE',
          message: 'นักเรียนที่ระบุไม่ได้อยู่ในภาคเรียนต้นทาง',
          entityId: override.studentId,
        });
        continue;
      }
      if (
        override.targetSourceClassroomId !== undefined &&
        !sourceRoomById.has(override.targetSourceClassroomId)
      ) {
        issues.push({
          code: 'UNKNOWN_OVERRIDE_TARGET',
          message: 'ไม่พบห้องเป้าหมายที่ระบุในข้อยกเว้น',
          entityId: override.studentId,
        });
        continue;
      }
      overrides.set(override.studentId, override);
    }

    const students: PlannedStudent[] = [];
    for (const room of sourceRooms) {
      const mapping = mappingBySourceId.get(room.id);
      for (const enrollment of room.enrollments) {
        const override = overrides.get(enrollment.studentId);
        const action =
          override?.action ?? mapping?.defaultAction ?? PromotionAction.SKIP;
        const needsTarget =
          action === PromotionAction.MOVE || action === PromotionAction.REPEAT;
        const targetSourceClassroomId = needsTarget
          ? (override?.targetSourceClassroomId ?? room.id)
          : null;
        if (needsTarget) {
          const targetMapping = mappingBySourceId.get(
            targetSourceClassroomId as number,
          );
          if (!targetMapping?.targetName) {
            issues.push({
              code: 'STUDENT_TARGET_CLASSROOM_REQUIRED',
              message: 'นักเรียนที่ MOVE หรือ REPEAT ยังไม่มีห้องปลายทาง',
              entityId: enrollment.studentId,
            });
          }
        }
        students.push({
          studentId: enrollment.studentId,
          citizenId: enrollment.student.citizenId,
          firstName: enrollment.student.firstName,
          lastName: enrollment.student.lastName,
          sourceClassroomId: room.id,
          targetSourceClassroomId,
          action,
        });
      }
    }

    return {
      sourceTerm,
      targetTerm,
      rooms,
      students,
      issues,
    };
  }

  private async buildTermRolloverPlan(
    prisma: RolloverClient,
    dto: PreviewTermRolloverDto,
  ): Promise<RolloverPlan> {
    if (dto.sourceTermId === dto.targetTermId) {
      throw new BadRequestException('ภาคเรียนต้นทางและปลายทางต้องไม่ซ้ำกัน');
    }

    const [sourceTerm, targetTerm] = await Promise.all([
      prisma.academicTerm.findUnique({ where: { id: dto.sourceTermId } }),
      prisma.academicTerm.findUnique({ where: { id: dto.targetTermId } }),
    ]);
    if (!sourceTerm) {
      throw new NotFoundException(
        `ไม่พบภาคเรียนต้นทาง ID: ${dto.sourceTermId}`,
      );
    }
    if (!targetTerm) {
      throw new NotFoundException(
        `ไม่พบภาคเรียนปลายทาง ID: ${dto.targetTermId}`,
      );
    }
    if (
      sourceTerm.year !== targetTerm.year ||
      sourceTerm.term >= targetTerm.term
    ) {
      throw new BadRequestException(
        'การเปลี่ยนภาคเรียนต้องไปยังเทอมที่สูงกว่าในปีการศึกษาเดียวกัน',
      );
    }

    const [sourceRooms, targetRooms] = await Promise.all([
      prisma.classroom.findMany({
        where: { termId: sourceTerm.id },
        include: rolloverRoomInclude,
        orderBy: { name: 'asc' },
      }),
      prisma.classroom.findMany({
        where: { termId: targetTerm.id },
        include: rolloverRoomInclude,
        orderBy: { name: 'asc' },
      }),
    ]);

    const issues: RolloverIssue[] = [];
    if (sourceRooms.length === 0) {
      issues.push({
        code: 'SOURCE_HAS_NO_CLASSROOMS',
        message: 'ภาคเรียนต้นทางไม่มีห้องเรียน',
      });
    }

    const sourceRoomById = new Map(sourceRooms.map((room) => [room.id, room]));
    const requestedMappings = new Map<number, string>();
    for (const mapping of dto.classroomMappings ?? []) {
      if (requestedMappings.has(mapping.sourceClassroomId)) {
        issues.push({
          code: 'DUPLICATE_CLASSROOM_MAPPING',
          message: 'ระบุ mapping ของห้องต้นทางซ้ำ',
          entityId: mapping.sourceClassroomId,
        });
        continue;
      }
      if (!sourceRoomById.has(mapping.sourceClassroomId)) {
        issues.push({
          code: 'UNKNOWN_SOURCE_CLASSROOM',
          message: 'ห้องที่ระบุไม่ได้อยู่ในภาคเรียนต้นทาง',
          entityId: mapping.sourceClassroomId,
        });
        continue;
      }
      requestedMappings.set(
        mapping.sourceClassroomId,
        mapping.targetName?.trim() ||
          sourceRoomById.get(mapping.sourceClassroomId)!.name,
      );
    }

    const targetRoomsByName = new Map<string, RolloverRoom[]>();
    for (const room of targetRooms) {
      const matches = targetRoomsByName.get(room.name) ?? [];
      matches.push(room);
      targetRoomsByName.set(room.name, matches);
    }

    const rooms: PlannedRoom[] = sourceRooms.map((source) => {
      const targetName = requestedMappings.get(source.id) ?? source.name;
      const matches = targetRoomsByName.get(targetName) ?? [];
      if (matches.length > 1) {
        issues.push({
          code: 'DUPLICATE_TARGET_CLASSROOM_NAME',
          message: `มีห้องปลายทางชื่อ "${targetName}" มากกว่าหนึ่งห้อง`,
          entityId: source.id,
        });
      }
      const existingTarget = matches[0] ?? null;
      if (
        existingTarget &&
        (existingTarget.students.length > 0 ||
          existingTarget._count.enrollments > 0 ||
          existingTarget._count.attendanceRecords > 0 ||
          existingTarget._count.behaviorRecords > 0)
      ) {
        issues.push({
          code: 'TARGET_CLASSROOM_NOT_EMPTY',
          message: `ห้องปลายทาง "${targetName}" มีนักเรียนอยู่แล้ว`,
          entityId: existingTarget.id,
        });
      }
      return { source, targetName, existingTarget };
    });

    const duplicateTargetNames = new Set<string>();
    const targetNameCounts = new Map<string, number>();
    for (const room of rooms) {
      if (room.targetName === null) continue;
      const count = (targetNameCounts.get(room.targetName) ?? 0) + 1;
      targetNameCounts.set(room.targetName, count);
      if (count > 1) duplicateTargetNames.add(room.targetName);
    }
    for (const name of duplicateTargetNames) {
      issues.push({
        code: 'MAPPINGS_SHARE_TARGET_NAME',
        message: `ห้องต้นทางหลายห้องถูกจับคู่ไปยังชื่อ "${name}"`,
      });
    }

    const rosterStudentIds = new Set<string>();
    for (const room of sourceRooms) {
      const enrollmentIds = new Set(
        room.enrollments.map((enrollment) => enrollment.studentId),
      );
      const currentStudentIds = new Set(
        room.students.map((student) => student.id),
      );
      const rosterMatches =
        enrollmentIds.size === currentStudentIds.size &&
        [...enrollmentIds].every((id) => currentStudentIds.has(id));
      if (!rosterMatches) {
        issues.push({
          code: 'SOURCE_ROSTER_NOT_BACKFILLED',
          message: `Enrollment ของห้อง "${room.name}" ไม่ตรงกับห้องปัจจุบัน`,
          entityId: room.id,
        });
      }
      for (const enrollment of room.enrollments) {
        if (rosterStudentIds.has(enrollment.studentId)) {
          issues.push({
            code: 'DUPLICATE_ACTIVE_ENROLLMENT',
            message: 'นักเรียนมี ACTIVE Enrollment ซ้ำในภาคเรียนต้นทาง',
            entityId: enrollment.studentId,
          });
        }
        rosterStudentIds.add(enrollment.studentId);
        if (enrollment.student.classroomId !== room.id) {
          issues.push({
            code: 'CURRENT_CLASSROOM_MISMATCH',
            message: 'ห้องปัจจุบันของนักเรียนไม่ตรงกับ Enrollment',
            entityId: enrollment.studentId,
          });
        }
      }
    }

    if (rosterStudentIds.size > 0) {
      const activeEnrollments = await prisma.studentEnrollment.findMany({
        where: {
          studentId: { in: [...rosterStudentIds] },
          status: EnrollmentStatus.ACTIVE,
        },
        select: { studentId: true },
      });
      const activeCountByStudent = new Map<string, number>();
      for (const enrollment of activeEnrollments) {
        activeCountByStudent.set(
          enrollment.studentId,
          (activeCountByStudent.get(enrollment.studentId) ?? 0) + 1,
        );
      }
      for (const studentId of rosterStudentIds) {
        if (activeCountByStudent.get(studentId) !== 1) {
          issues.push({
            code: 'INVALID_ACTIVE_ENROLLMENT_COUNT',
            message: 'นักเรียนต้องมี ACTIVE Enrollment เพียงหนึ่งรายการ',
            entityId: studentId,
          });
        }
      }
    }

    const overrides = new Map<
      string,
      {
        action: PromotionAction;
        targetSourceClassroomId?: number;
      }
    >();
    for (const override of dto.studentOverrides ?? []) {
      if (overrides.has(override.studentId)) {
        issues.push({
          code: 'DUPLICATE_STUDENT_OVERRIDE',
          message: 'ระบุข้อยกเว้นของนักเรียนซ้ำ',
          entityId: override.studentId,
        });
        continue;
      }
      if (!rosterStudentIds.has(override.studentId)) {
        issues.push({
          code: 'UNKNOWN_STUDENT_OVERRIDE',
          message: 'นักเรียนที่ระบุไม่ได้อยู่ในภาคเรียนต้นทาง',
          entityId: override.studentId,
        });
        continue;
      }
      const allowedActions = new Set<PromotionAction>([
        PromotionAction.MOVE,
        PromotionAction.TRANSFER_OUT,
        PromotionAction.SKIP,
      ]);
      if (!allowedActions.has(override.action)) {
        issues.push({
          code: 'UNSUPPORTED_TERM_ROLLOVER_ACTION',
          message: 'Term rollover รองรับเฉพาะ MOVE, TRANSFER_OUT และ SKIP',
          entityId: override.studentId,
        });
        continue;
      }
      if (
        override.targetSourceClassroomId !== undefined &&
        !sourceRoomById.has(override.targetSourceClassroomId)
      ) {
        issues.push({
          code: 'UNKNOWN_OVERRIDE_TARGET',
          message: 'ไม่พบห้องเป้าหมายที่ระบุในข้อยกเว้น',
          entityId: override.studentId,
        });
        continue;
      }
      overrides.set(override.studentId, override);
    }

    const students: PlannedStudent[] = [];
    for (const room of sourceRooms) {
      for (const enrollment of room.enrollments) {
        const override = overrides.get(enrollment.studentId);
        const action = override?.action ?? PromotionAction.MOVE;
        const targetSourceClassroomId =
          action === PromotionAction.MOVE
            ? (override?.targetSourceClassroomId ?? room.id)
            : null;
        students.push({
          studentId: enrollment.studentId,
          citizenId: enrollment.student.citizenId,
          firstName: enrollment.student.firstName,
          lastName: enrollment.student.lastName,
          sourceClassroomId: room.id,
          targetSourceClassroomId,
          action,
        });
      }
    }

    return {
      sourceTerm,
      targetTerm,
      rooms,
      students,
      issues,
    };
  }
}
