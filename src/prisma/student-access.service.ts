import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type Actor = { userId: string; role: Role };

@Injectable()
export class StudentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  // Behavior scoring is school-wide for teachers; attendance/student management remain advisory-scoped.
  async behavior(actor: Actor, studentId: string) {
    if (actor.role === Role.TEACHER) return;
    await this.student(actor, studentId);
  }

  async student(actor: Actor, studentId: string) {
    if (actor.role === Role.ADMIN || actor.role === Role.AFFAIRS) return;
    const scope =
      actor.role === Role.STUDENT
        ? { id: actor.userId }
        : actor.role === Role.PARENT
          ? { parentId: actor.userId }
          : actor.role === Role.TEACHER
            ? { classroom: { advisors: { some: { id: actor.userId } } } }
            : null;
    if (
      !scope ||
      !(await this.prisma.user.findFirst({
        where: { AND: [{ id: studentId, role: Role.STUDENT }, scope] },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงข้อมูลนักเรียนนี้');
  }

  async classroom(actor: Actor, classroomId?: number | null) {
    if (actor.role === Role.ADMIN || actor.role === Role.AFFAIRS) return;
    if (
      actor.role !== Role.TEACHER ||
      !classroomId ||
      !(await this.prisma.classroom.findFirst({
        where: { id: classroomId, advisors: { some: { id: actor.userId } } },
        select: { id: true },
      }))
    )
      throw new ForbiddenException('คุณไม่มีสิทธิ์เข้าถึงข้อมูลห้องนี้');
  }
}
