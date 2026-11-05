import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PhotographyBookingKind,
  PhotographyBookingStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ApprovePhotographyBookingDto,
  CreatePhotographyBookingDto,
  PhotographyListQuery,
} from './photography.dto';
import { bookingSlots, peakQuantity, TimeSlot } from './photography.policy';

type Actor = { userId: string; role: Role };
type DB = Prisma.TransactionClient;
const person = { id: true, firstName: true, lastName: true } as const;
const details = {
  requester: { select: person },
  reviewer: { select: person },
  department: true,
  slots: { orderBy: { startsAt: 'asc' as const } },
  assignments: {
    include: {
      student: { select: { ...person, classroom: { select: { name: true } } } },
    },
  },
  equipment: { include: { equipment: true } },
} satisfies Prisma.PhotographyBookingInclude;

@Injectable()
export class PhotographyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  ready() {
    if (process.env.PHOTOGRAPHY_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'ระบบจองช่างภาพยังไม่เปิดให้บริการ',
      );
  }
  private async access(
    db: DB,
    actor: Actor,
    management = false,
    admin = false,
  ) {
    this.ready();
    const user = await db.user.findUnique({
      where: { id: actor.userId },
      select: { role: true, photographyManager: true },
    });
    if (!user || user.role === Role.PARENT)
      throw new ForbiddenException('ไม่มีสิทธิ์ใช้งานระบบจองช่างภาพ');
    const canManage =
      user.role === Role.ADMIN ||
      (user.role === Role.TEACHER && !!user.photographyManager);
    if ((management && !canManage) || (admin && user.role !== Role.ADMIN))
      throw new ForbiddenException('เฉพาะผู้รับผิดชอบด้านการถ่ายภาพเท่านั้น');
    return {
      role: user.role,
      canManage,
      canBook: [Role.ADMIN, Role.TEACHER, Role.AFFAIRS].some(
        (role) => role === user.role,
      ),
    };
  }
  // Lock before reading permissions, availability or state. A concurrent approval cannot pass stale checks.
  private write<T>(
    actor: Actor,
    management: boolean,
    admin: boolean,
    action: (tx: DB) => Promise<T>,
  ) {
    this.ready();
    return this.prisma.$transaction(
      async (tx) => {
        await tx.photographyMutex.update({
          where: { id: 1 },
          data: { revision: { increment: 1 } },
        });
        await this.access(tx, actor, management, admin);
        return action(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 20000,
      },
    );
  }
  async metadata(actor: Actor) {
    const permissions = await this.access(this.prisma, actor);
    const [departments, equipment, roster, user] = await Promise.all([
      this.prisma.photographyDepartment.findMany({
        where: permissions.canManage ? {} : { active: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.photographyEquipment.findMany({
        where: permissions.canManage ? {} : { active: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.photographer.findUnique({ where: { userId: actor.userId } }),
      this.prisma.user.findUnique({
        where: { id: actor.userId },
        select: person,
      }),
    ]);
    return {
      ...permissions,
      user,
      isPhotographer: !!roster?.active,
      departments,
      equipment,
    };
  }
  async managers(actor: Actor) {
    await this.access(this.prisma, actor, false, true);
    return this.prisma.photographyManager.findMany({
      include: { user: { select: person } },
      orderBy: { createdAt: 'asc' },
    });
  }
  setManager(actor: Actor, userId: string, active: boolean) {
    return this.write(actor, false, true, async (tx) => {
      if (active) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (user?.role !== Role.TEACHER)
          throw new BadRequestException('เลือกได้เฉพาะบัญชีครู');
        await tx.photographyManager.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
      } else await tx.photographyManager.deleteMany({ where: { userId } });
      return { success: true };
    });
  }
  async directory(actor: Actor, role: 'TEACHER' | 'STUDENT', q = '') {
    await this.access(this.prisma, actor, true, role === 'TEACHER');
    const parts = q.trim().split(/\s+/).filter(Boolean);
    if (parts.join('').length < 2) return [];
    return this.prisma.user.findMany({
      where: {
        role,
        AND: parts.map((part) => ({
          OR: [
            { firstName: { contains: part } },
            { lastName: { contains: part } },
            ...(role === 'STUDENT'
              ? [{ classroom: { name: { contains: part } } }]
              : []),
          ],
        })),
      },
      select: { ...person, classroom: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 50,
    });
  }
  async photographers(actor: Actor) {
    await this.access(this.prisma, actor, true);
    return this.prisma.photographer.findMany({
      include: {
        user: {
          select: {
            ...person,
            role: true,
            classroom: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
  setPhotographer(actor: Actor, userId: string, active: boolean) {
    return this.write(actor, true, false, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role !== Role.STUDENT)
        throw new BadRequestException('เลือกได้เฉพาะบัญชีนักเรียน');
      return tx.photographer.upsert({
        where: { userId },
        create: { userId, active },
        update: { active },
      });
    });
  }
  saveDepartment(actor: Actor, name: string) {
    return this.write(actor, true, false, async (tx) => {
      name = name.trim();
      if (!name)
        throw new BadRequestException('กรุณาระบุชื่อกลุ่มสาระ/กลุ่มงาน');
      return tx.photographyDepartment.upsert({
        where: { name },
        create: { name },
        update: { active: true },
      });
    });
  }
  setDepartmentActive(actor: Actor, id: string, active: boolean) {
    return this.write(actor, true, false, async (tx) => {
      if (!(await tx.photographyDepartment.findUnique({ where: { id } })))
        throw new NotFoundException();
      return tx.photographyDepartment.update({
        where: { id },
        data: { active },
      });
    });
  }
  saveEquipment(actor: Actor, name: string, quantity: number) {
    return this.write(actor, true, false, async (tx) => {
      name = name.trim();
      if (!name) throw new BadRequestException('กรุณาระบุชื่ออุปกรณ์');
      const existing = await tx.photographyEquipment.findUnique({
        where: { name },
      });
      if (existing) {
        const items = await tx.photographyBookingEquipment.findMany({
          where: {
            equipmentId: existing.id,
            booking: {
              status: 'APPROVED',
              slots: { some: { endsAt: { gt: new Date() } } },
            },
          },
          include: { booking: { include: { slots: true } } },
        });
        const reserved = items.flatMap((i) =>
          i.booking.slots
            .filter((s) => s.endsAt > new Date())
            .map((s) => ({ ...s, quantity: i.quantity })),
        );
        if (peakQuantity(reserved) > quantity)
          throw new ConflictException(
            'จำนวนอุปกรณ์ต่ำกว่าจำนวนที่อนุมัติให้ยืมไว้',
          );
      }
      return tx.photographyEquipment.upsert({
        where: { name },
        create: { name, quantity },
        update: { quantity, active: true },
      });
    });
  }
  setEquipmentActive(actor: Actor, id: string, active: boolean) {
    return this.write(actor, true, false, async (tx) => {
      if (!(await tx.photographyEquipment.findUnique({ where: { id } })))
        throw new NotFoundException();
      return tx.photographyEquipment.update({
        where: { id },
        data: { active },
      });
    });
  }
  private scope(
    actor: Actor,
    manage: boolean,
  ): Prisma.PhotographyBookingWhereInput {
    if (manage) return {};
    return actor.role === Role.STUDENT
      ? { assignments: { some: { studentId: actor.userId } } }
      : { requesterId: actor.userId };
  }
  async list(actor: Actor, query: PhotographyListQuery) {
    const permissions = await this.access(this.prisma, actor);
    const where = {
      ...this.scope(
        { ...actor, role: permissions.role },
        permissions.canManage,
      ),
      ...(query.status ? { status: query.status } : {}),
    };
    const page = query.page ?? 1;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.photographyBooking.findMany({
        where,
        include: details,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 30,
        take: 30,
      }),
      this.prisma.photographyBooking.count({ where }),
    ]);
    return { items, total, page, pageSize: 30 };
  }
  async detail(actor: Actor, id: string) {
    const permissions = await this.access(this.prisma, actor);
    const result = await this.prisma.photographyBooking.findFirst({
      where: {
        id,
        ...this.scope(
          { ...actor, role: permissions.role },
          permissions.canManage,
        ),
      },
      include: details,
    });
    if (!result) throw new NotFoundException('ไม่พบรายการจอง');
    return result;
  }
  create(actor: Actor, dto: CreatePhotographyBookingDto) {
    return this.write(actor, false, false, async (tx) => {
      const access = await this.access(tx, actor);
      if (!access.canBook)
        throw new ForbiddenException(
          'เฉพาะครูและบุคลากรเท่านั้นที่สร้างรายการจองได้',
        );
      const slots = bookingSlots(dto.slots);
      const activityName = dto.activityName.trim(),
        location = dto.location.trim();
      if (!activityName || !location)
        throw new BadRequestException('กรุณาระบุชื่อกิจกรรมและสถานที่');
      const department = await tx.photographyDepartment.findFirst({
        where: { id: dto.departmentId, active: true },
      });
      if (!department)
        throw new BadRequestException(
          'กรุณาเลือกกลุ่มสาระ/กลุ่มงานที่เปิดใช้งาน',
        );
      if (dto.kind === PhotographyBookingKind.PHOTOGRAPHERS) {
        if (dto.photographerCount < 1 || dto.equipment.length)
          throw new BadRequestException(
            'ระบุจำนวนช่างภาพอย่างน้อย 1 คน และไม่ระบุอุปกรณ์ในคำขอช่างภาพ',
          );
      } else {
        if (dto.photographerCount !== 0 || !dto.equipment.length)
          throw new BadRequestException(
            'คำขอยืมอุปกรณ์ต้องระบุอุปกรณ์แทนช่างภาพ',
          );
        const equipment = await tx.photographyEquipment.findMany({
          where: {
            id: { in: dto.equipment.map((i) => i.equipmentId) },
            active: true,
          },
        });
        if (equipment.length !== dto.equipment.length)
          throw new BadRequestException(
            'อุปกรณ์ไม่พร้อมให้ยืมหรือระบุรายการซ้ำ',
          );
        for (const item of dto.equipment)
          if (
            item.quantity >
            equipment.find((e) => e.id === item.equipmentId)!.quantity
          )
            throw new BadRequestException(
              'จำนวนที่ขอยืมเกินจำนวนอุปกรณ์ทั้งหมด',
            );
      }
      const result = await tx.photographyBooking.create({
        data: {
          requesterId: actor.userId,
          activityName,
          location,
          kind: dto.kind,
          photographerCount: dto.photographerCount,
          departmentId: department.id,
          hasLunch: dto.hasLunch,
          slots: { create: slots },
          equipment: { create: dto.equipment },
        },
        include: details,
      });
      const managers = await tx.photographyManager.findMany({
        where: { user: { role: Role.TEACHER } },
        select: { userId: true },
      });
      await this.notify(
        tx,
        managers.map((m) => m.userId),
        result.id,
        'มีคำขอจองใหม่',
        result.activityName,
      );
      return result;
    });
  }
  private overlaps(slots: TimeSlot[]) {
    return slots.map((s) => ({
      startsAt: { lt: s.endsAt },
      endsAt: { gt: s.startsAt },
    }));
  }
  async availability(actor: Actor, id: string) {
    await this.access(this.prisma, actor, true);
    const booking = await this.prisma.photographyBooking.findUnique({
      where: { id },
      include: { slots: true },
    });
    if (!booking) throw new NotFoundException();
    const [roster, busy] = await Promise.all([
      this.prisma.photographer.findMany({
        where: { active: true, user: { role: Role.STUDENT } },
        include: {
          user: {
            select: { ...person, classroom: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.photographyAssignment.findMany({
        where: {
          bookingId: { not: id },
          booking: {
            status: 'APPROVED',
            slots: { some: { OR: this.overlaps(booking.slots) } },
          },
        },
        select: { studentId: true },
      }),
    ]);
    const ids = new Set(busy.map((s) => s.studentId));
    return roster.map((p) => ({ ...p, busy: ids.has(p.userId) }));
  }
  approve(actor: Actor, id: string, dto: ApprovePhotographyBookingDto) {
    return this.write(actor, true, false, async (tx) => {
      const booking = await this.pending(tx, id);
      if (booking.slots.some((s) => s.startsAt <= new Date()))
        throw new ConflictException('งานเริ่มไปแล้ว ไม่สามารถอนุมัติได้');
      if (booking.kind === 'PHOTOGRAPHERS') {
        if (
          dto.studentIds.length !== booking.photographerCount ||
          new Set(dto.studentIds).size !== dto.studentIds.length
        )
          throw new BadRequestException(
            `กรุณาเลือกช่างภาพ ${booking.photographerCount} คนโดยไม่ซ้ำกัน`,
          );
        const roster = await tx.photographer.count({
          where: {
            userId: { in: dto.studentIds },
            active: true,
            user: { role: Role.STUDENT },
          },
        });
        if (roster !== dto.studentIds.length)
          throw new BadRequestException(
            'ช่างภาพบางคนไม่ได้อยู่ในทีมที่เปิดใช้งาน',
          );
        const conflict = await tx.photographyAssignment.findFirst({
          where: {
            studentId: { in: dto.studentIds },
            booking: {
              status: 'APPROVED',
              slots: { some: { OR: this.overlaps(booking.slots) } },
            },
          },
        });
        if (conflict)
          throw new ConflictException(
            'ช่างภาพบางคนมีงานในช่วงเวลานี้แล้ว กรุณาเลือกใหม่',
          );
      } else {
        if (dto.studentIds.length)
          throw new BadRequestException('คำขอยืมอุปกรณ์ไม่ต้องมอบหมายช่างภาพ');
        for (const item of booking.equipment) {
          if (!item.equipment.active)
            throw new ConflictException('อุปกรณ์บางรายการปิดให้ยืมแล้ว');
          const reservations = await tx.photographyBookingEquipment.findMany({
            where: {
              equipmentId: item.equipmentId,
              booking: {
                status: 'APPROVED',
                slots: { some: { OR: this.overlaps(booking.slots) } },
              },
            },
            include: { booking: { include: { slots: true } } },
          });
          const intervals = reservations.flatMap((r) =>
            r.booking.slots.map((s) => ({ ...s, quantity: r.quantity })),
          );
          intervals.push(
            ...booking.slots.map((s) => ({ ...s, quantity: item.quantity })),
          );
          if (peakQuantity(intervals) > item.equipment.quantity)
            throw new ConflictException(
              `อุปกรณ์ ${item.equipment.name} ไม่เพียงพอในช่วงเวลาที่เลือก`,
            );
        }
      }
      const result = await tx.photographyBooking.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewerId: actor.userId,
          reviewedAt: new Date(),
          reviewNote: dto.note?.trim() || null,
          assignments: {
            create: dto.studentIds.map((studentId) => ({ studentId })),
          },
        },
        include: details,
      });
      await this.notify(
        tx,
        [booking.requesterId],
        id,
        'อนุมัติคำขอแล้ว',
        booking.activityName,
      );
      const times = booking.slots
        .map((s) => `${this.time(s.startsAt)} – ${this.time(s.endsAt)}`)
        .join('\n');
      await this.notify(
        tx,
        dto.studentIds,
        id,
        'คุณได้รับมอบหมายงานถ่ายภาพ',
        `${booking.activityName}\nสถานที่: ${booking.location}\n${times}\nอาหารกลางวัน: ${booking.hasLunch ? 'มี' : 'ไม่มี'}`,
      );
      return result;
    });
  }
  reject(actor: Actor, id: string, note: string) {
    return this.write(actor, true, false, async (tx) => {
      const booking = await this.pending(tx, id);
      if (!note.trim())
        throw new BadRequestException('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
      const result = await tx.photographyBooking.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewerId: actor.userId,
          reviewedAt: new Date(),
          reviewNote: note.trim(),
        },
        include: details,
      });
      await this.notify(
        tx,
        [booking.requesterId],
        id,
        'คำขอไม่ได้รับอนุมัติ',
        `${booking.activityName}\n${note.trim()}`,
      );
      return result;
    });
  }
  cancel(actor: Actor, id: string, note: string) {
    return this.write(actor, false, false, async (tx) => {
      const permissions = await this.access(tx, actor);
      const booking = await tx.photographyBooking.findUnique({
        where: { id },
        include: details,
      });
      if (
        !booking ||
        (!permissions.canManage && booking.requesterId !== actor.userId)
      )
        throw new NotFoundException();
      if (!['PENDING', 'APPROVED'].includes(booking.status))
        throw new ConflictException(
          'ยกเลิกได้เฉพาะคำขอที่รออนุมัติหรืออนุมัติแล้ว',
        );
      if (booking.slots.some((s) => s.startsAt <= new Date()))
        throw new ConflictException('งานเริ่มไปแล้ว ไม่สามารถยกเลิกได้');
      if (!note.trim())
        throw new BadRequestException('กรุณาระบุเหตุผลที่ยกเลิก');
      const result = await tx.photographyBooking.update({
        where: { id },
        data: { status: 'CANCELLED', reviewNote: note.trim() },
        include: details,
      });
      const managers = await tx.photographyManager.findMany({
        where: { user: { role: Role.TEACHER } },
        select: { userId: true },
      });
      await this.notify(
        tx,
        [
          booking.requesterId,
          ...booking.assignments.map((s) => s.studentId),
          ...managers.map((m) => m.userId),
        ],
        id,
        'ยกเลิกงานแล้ว',
        `${booking.activityName}\n${note.trim()}`,
      );
      return result;
    });
  }
  private async pending(tx: DB, id: string) {
    const booking = await tx.photographyBooking.findUnique({
      where: { id },
      include: details,
    });
    if (!booking) throw new NotFoundException('ไม่พบรายการจอง');
    if (booking.status !== PhotographyBookingStatus.PENDING)
      throw new ConflictException(
        'รายการนี้ได้รับการดำเนินการแล้ว กรุณาโหลดข้อมูลใหม่',
      );
    return booking;
  }
  private time(value: Date) {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  }
  private async notify(
    tx: DB,
    userIds: string[],
    bookingId: string,
    title: string,
    body: string,
  ) {
    const recipients = [...new Set(userIds)];
    if (!recipients.length) return;
    const eventId = `photography:${bookingId}:${randomUUID()}`;
    await this.notifications.enqueueUsers(
      tx,
      recipients,
      'photography',
      eventId,
      { title, body },
    );
    const linked = await tx.user.findMany({
      where: { id: { in: recipients }, lineUserId: { not: null } },
      select: { id: true },
    });
    // Only accept an explicitly configured LIFF app URL; messages work without a link too.
    const url = process.env.PHOTOGRAPHY_MINI_APP_URL;
    let link = '';
    if (url) {
      try {
        const target = new URL(url);
        if (target.protocol === 'https:') {
          target.searchParams.set('bookingId', bookingId);
          link = `\nดูรายละเอียด: ${target.toString()}`;
        }
      } catch {
        /* Optional link. */
      }
    }
    if (linked.length)
      await tx.photographyLineDelivery.createMany({
        data: linked.map((u) => ({
          eventId,
          userId: u.id,
          message: `${title}\n\n${body}${link}`,
        })),
        skipDuplicates: true,
      });
  }
}
