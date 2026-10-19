import { createHash, randomBytes } from 'node:crypto';
import { LineIdentityService } from '../auth/line-identity.service';
import type { Actor } from '../prisma/student-access.service';
import { CreateLinkInvitationDto } from './dto/create-link-invitation.dto';
import {
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParentDto } from './dto/create-parent.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from 'src/auth/dto/login.dto';
import { AddChildDto } from './dto/add-child.dto';

@Injectable()
export class ParentsService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private readonly lineIdentity: LineIdentityService,
  ) {}

  async issueInvitation(dto: CreateLinkInvitationDto, actor: Actor) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.AFFAIRS)
      throw new ForbiddenException();
    const student = await this.prisma.user.findUnique({
      where: { citizenId: dto.studentCitizenId },
    });
    if (!student || student.role !== Role.STUDENT)
      throw new NotFoundException('ไม่พบข้อมูลนักเรียน');
    if (student.parentId)
      throw new ConflictException(
        'นักเรียนมีผู้ปกครองแล้ว กรุณาติดต่อโรงเรียน',
      );
    const invitationCode = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.parentLinkInvitation.create({
      data: {
        tokenHash: this.hashCode(invitationCode),
        studentId: student.id,
        parentCitizenId: dto.parentCitizenId,
        issuedBy: actor.userId,
        expiresAt,
      },
    });
    return { invitationCode, expiresAt };
  }

  private hashCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  private async claimInvitation(
    tx: any,
    code: string | undefined,
    studentId: string,
    parentCitizenId: string,
  ) {
    if (!code)
      throw new ForbiddenException('กรุณาระบุรหัสเชื่อมโยงที่โรงเรียนออกให้');
    const claimed = await tx.parentLinkInvitation.updateMany({
      where: {
        tokenHash: this.hashCode(code),
        studentId,
        parentCitizenId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1)
      throw new ForbiddenException(
        'รหัสเชื่อมโยงไม่ถูกต้อง ถูกใช้แล้ว หรือหมดอายุ',
      );
  }

  async register(dto: CreateParentDto, actor?: Actor) {
    const admin = actor?.role === Role.ADMIN;
    if (!admin && !dto.invitationCode)
      throw new ForbiddenException('กรุณาระบุรหัสเชื่อมโยงที่โรงเรียนออกให้');
    // A native signup has no LINE identity. A LINE signup must prove ownership to LINE.
    const lineUserId = dto.lineUserId
      ? admin
        ? dto.lineUserId
        : await this.lineIdentity.verify(dto.accessToken, dto.lineUserId)
      : null;
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const student = await tx.user.findUnique({
          where: { citizenId: dto.studentCitizenId },
        });
        if (!student || student.role !== Role.STUDENT || student.parentId) {
          throw new ConflictException(
            'ไม่สามารถเชื่อมโยงนักเรียน กรุณาติดต่อโรงเรียน',
          );
        }
        if (!admin)
          await this.claimInvitation(
            tx,
            dto.invitationCode,
            student.id,
            dto.citizenId,
          );
        const parent = await tx.user.create({
          data: {
            citizenId: dto.citizenId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            password: hashedPassword,
            role: Role.PARENT,
            lineUserId,
          },
        });
        const linked = await tx.user.updateMany({
          where: { id: student.id, role: Role.STUDENT, parentId: null },
          data: { parentId: parent.id },
        });
        if (linked.count !== 1)
          throw new ConflictException(
            'นักเรียนมีผู้ปกครองแล้ว กรุณาติดต่อโรงเรียน',
          );
        return parent;
      });
      const { password, ...user } = result;
      return { message: 'ลงทะเบียนผู้ปกครองสำเร็จ', user };
    } catch (error) {
      if ((error as any)?.code === 'P2034')
        throw new ConflictException(
          'ข้อมูลถูกเปลี่ยนพร้อมกัน กรุณาตรวจสอบข้อมูลล่าสุด',
        );
      if ((error as any)?.code === 'P2002')
        throw new ConflictException('ข้อมูลบัญชีนี้ถูกใช้งานแล้ว');
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { citizenId: dto.citizenId },
      include: {
        // หากเป็นผู้ปกครอง ให้ดึงรายชื่อนักเรียนในปกครองมาด้วย
        children: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            classroom: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('รหัสประจำตัว หรือ รหัสผ่านไม่ถูกต้อง');
    }

    const payload = {
      sub: user.id,
      citizenId: user.citizenId,
      role: user.role,
    };

    return {
      message: 'เข้าสู่ระบบสำเร็จ',
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        // ส่งรายชื่อลูกๆ กลับไป (ถ้ามี)
        children: user.children || [],
      },
    };
  }

  async addChild(parentId: string, dto: AddChildDto, actor: Actor) {
    if (
      actor.role !== Role.ADMIN &&
      (actor.role !== Role.PARENT || parentId !== actor.userId)
    ) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์เชื่อมโยงแทนผู้ปกครองอื่น');
    }
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.user.findUnique({ where: { id: parentId } });
      if (!parent || parent.role !== Role.PARENT)
        throw new NotFoundException('ไม่พบบัญชีผู้ปกครอง');
      const student = await tx.user.findUnique({
        where: { citizenId: dto.studentCitizenId },
      });
      if (!student || student.role !== Role.STUDENT || student.parentId) {
        throw new ConflictException(
          'ไม่สามารถเชื่อมโยงนักเรียน กรุณาติดต่อโรงเรียน',
        );
      }
      if (actor.role !== Role.ADMIN)
        await this.claimInvitation(
          tx,
          dto.invitationCode,
          student.id,
          parent.citizenId,
        );
      const linked = await tx.user.updateMany({
        where: { id: student.id, role: Role.STUDENT, parentId: null },
        data: { parentId },
      });
      if (linked.count !== 1)
        throw new ConflictException(
          'นักเรียนมีผู้ปกครองแล้ว กรุณาติดต่อโรงเรียน',
        );
      return tx.user.findUnique({
        where: { id: student.id },
        select: {
          firstName: true,
          lastName: true,
          classroom: { select: { name: true } },
        },
      });
    });
  }

  async findAll() {
    const parents = await this.prisma.user.findMany({
      where: {
        role: Role.PARENT, // กรองเฉพาะผู้ใช้งานที่มีบทบาทเป็นผู้ปกครอง
      },
      select: {
        id: true,
        citizenId: true,
        firstName: true,
        lastName: true,
        lineUserId: true,
        createdAt: true,
        // ดึงข้อมูลนักเรียนที่เชื่อมโยงกับผู้ปกครองคนนี้
        children: {
          select: {
            id: true,
            citizenId: true,
            firstName: true,
            lastName: true,
            classroom: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return parents;
  }

  async removeParent(parentId: string) {
    // 1. เช็คว่ามีผู้ปกครองคนนี้จริงไหม
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      include: { children: true },
    });

    if (!parent || parent.role !== Role.PARENT) {
      throw new NotFoundException('ไม่พบข้อมูลผู้ปกครอง');
    }

    // 2. ใช้ Transaction เพื่อล้างความสัมพันธ์ก่อนลบตัว User
    await this.prisma.$transaction(async (prisma) => {
      // อัปเดตให้นักเรียนทุกคนที่เคยผูกกับคนนี้ กลายเป็นไม่มีผู้ปกครอง (parentId: null)
      await prisma.user.updateMany({
        where: { parentId: parentId },
        data: { parentId: null },
      });

      // ลบตัวผู้ปกครอง
      await prisma.user.delete({
        where: { id: parentId },
      });
    });

    return { message: 'ลบข้อมูลผู้ปกครองและล้างความสัมพันธ์สำเร็จ' };
  }
}
