import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../prisma/student-access.service';
import type { StudentLinkSelectionDto } from './dto/classroom-invitation.dto';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const ALPHABET = LOWER + UPPER + DIGITS;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const invalidCode = () =>
  new ForbiddenException(
    'รหัสห้องไม่ถูกต้องหรือหมดอายุ กรุณาตรวจสอบตัวพิมพ์เล็กและใหญ่',
  );

export function generateClassroomCode() {
  const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];
  const chars = [
    pick(LOWER),
    pick(UPPER),
    pick(DIGITS),
    pick(ALPHABET),
    pick(ALPHABET),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

@Injectable()
export class ClassroomParentLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(classroomId: number, actor: Actor) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.AFFAIRS)
      throw new ForbiddenException();
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classroomId },
      select: { id: true, name: true },
    });
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    const previous = await this.prisma.parentClassroomInvitation.findUnique({
      where: { classroomId },
      select: { tokenHash: true },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const invitationCode = generateClassroomCode();
      if (hash(invitationCode) === previous?.tokenHash) continue;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const data = {
        tokenHash: hash(invitationCode),
        issuedBy: actor.userId,
        expiresAt,
      };
      try {
        await this.prisma.parentClassroomInvitation.upsert({
          where: { classroomId },
          create: { classroomId, ...data },
          update: data,
        });
        return { invitationCode, expiresAt, classroom };
      } catch (error: unknown) {
        if ((error as { code?: string })?.code !== 'P2002') throw error;
      }
    }
    throw new ConflictException('ออกรหัสไม่สำเร็จ กรุณาลองอีกครั้ง');
  }

  async resolve(code: string) {
    const invitation = await this.prisma.parentClassroomInvitation.findUnique({
      where: { tokenHash: hash(code) },
      include: { classroom: { select: { id: true, name: true } } },
    });
    if (!invitation || invitation.expiresAt <= new Date()) throw invalidCode();
    const students = await this.prisma.user.findMany({
      where: {
        role: Role.STUDENT,
        classroomId: invitation.classroomId,
        parentId: null,
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    });
    return {
      classroom: invitation.classroom,
      students,
      expiresAt: invitation.expiresAt,
    };
  }

  async validate(
    tx: Prisma.TransactionClient,
    selections: StudentLinkSelectionDto[],
  ) {
    if (
      !selections.length ||
      selections.length > 100 ||
      new Set(selections.map((s) => s.studentId)).size !== selections.length
    ) {
      throw new BadRequestException('กรุณาเลือกนักเรียน 1–100 คน โดยไม่ซ้ำกัน');
    }
    const invitations = await tx.parentClassroomInvitation.findMany({
      where: {
        tokenHash: {
          in: [...new Set(selections.map((s) => hash(s.invitationCode)))],
        },
        expiresAt: { gt: new Date() },
      },
      select: { tokenHash: true, classroomId: true },
    });
    const students = await tx.user.findMany({
      where: {
        id: { in: selections.map((s) => s.studentId) },
        role: Role.STUDENT,
        parentId: null,
      },
      select: { id: true, classroomId: true },
    });
    const valid = selections.map((selection) => {
      const invitation = invitations.find(
        (item) => item.tokenHash === hash(selection.invitationCode),
      );
      const student = students.find((item) => item.id === selection.studentId);
      if (!invitation) throw invalidCode();
      if (!student || student.classroomId !== invitation.classroomId) {
        throw new ConflictException(
          'นักเรียนไม่ได้อยู่ในห้องของรหัสนี้ หรือมีผู้ปกครองแล้ว กรุณาโหลดรายชื่อใหม่',
        );
      }
      return { id: student.id, classroomId: invitation.classroomId };
    });
    return valid;
  }

  async attach(
    tx: Prisma.TransactionClient,
    parentId: string,
    students: { id: string; classroomId: number }[],
  ) {
    const linked = await tx.user.updateMany({
      where: { role: Role.STUDENT, parentId: null, OR: students },
      data: { parentId },
    });
    if (linked.count !== students.length)
      throw new ConflictException(
        'รายชื่อนักเรียนเปลี่ยนแปลง กรุณาโหลดรายชื่อใหม่',
      );
  }

  async addChildren(actor: Actor, selections: StudentLinkSelectionDto[]) {
    if (actor.role !== Role.PARENT) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { role: true },
      });
      if (parent?.role !== Role.PARENT) throw new ForbiddenException();
      const students = await this.validate(tx, selections);
      await this.attach(tx, actor.userId, students);
      return {
        message: 'เพิ่มนักเรียนในความดูแลสำเร็จ',
        count: students.length,
      };
    });
  }

  async removeChild(actor: Actor, studentId: string) {
    if (actor.role !== Role.PARENT) throw new ForbiddenException();
    const removed = await this.prisma.user.updateMany({
      where: { id: studentId, role: Role.STUDENT, parentId: actor.userId },
      data: { parentId: null },
    });
    if (removed.count !== 1)
      throw new NotFoundException('ไม่พบนักเรียนในความดูแลของบัญชีนี้');
    return { message: 'นำออกจากบัญชีผู้ปกครองแล้ว' };
  }
}
