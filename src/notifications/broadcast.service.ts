import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BroadcastAudienceDto, SendBroadcastDto } from './broadcast.dto';
import { inboxEnabled } from './notification-inbox.service';
import { pushEnabled } from './notifications.service';

// Use the same current-term population in the picker, preview and final send.
const studentWhere: Prisma.UserWhereInput = {
  role: Role.STUDENT,
  classroom: { term: { isActive: true } },
};
const personSelect = { id: true, firstName: true, lastName: true };

@Injectable()
export class BroadcastService {
  constructor(private readonly prisma: PrismaService) {}

  async options() {
    const [teachers, students, classrooms] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: Role.TEACHER },
        select: personSelect,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.user.findMany({
        where: studentWhere,
        select: { ...personSelect, classroomId: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.classroom.findMany({
        where: { term: { isActive: true } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      teachers,
      students,
      classrooms,
      inboxEnabled: inboxEnabled(),
      pushEnabled: pushEnabled(),
    };
  }

  private ready() {
    if (!inboxEnabled()) {
      throw new ServiceUnavailableException(
        'กรุณาเปิดใช้งานกล่องแจ้งเตือนในแอปก่อนส่ง Broadcast',
      );
    }
  }

  private async recipients(
    tx: Prisma.TransactionClient,
    dto: BroadcastAudienceDto,
  ) {
    let where: Prisma.UserWhereInput;
    if (dto.audience === 'CLASSROOMS') {
      if (
        dto.scope !== 'SELECTED' ||
        !dto.classroomIds.length ||
        dto.userIds.length
      ) {
        throw new BadRequestException('กรุณาเลือกห้องเรียนที่ต้องการส่ง');
      }
      const rooms = await tx.classroom.count({
        where: { id: { in: dto.classroomIds }, term: { isActive: true } },
      });
      if (rooms !== dto.classroomIds.length) {
        throw new BadRequestException(
          'มีห้องเรียนที่ไม่อยู่ในภาคเรียนปัจจุบัน กรุณาโหลดข้อมูลใหม่',
        );
      }
      where = { ...studentWhere, classroomId: { in: dto.classroomIds } };
    } else {
      if (
        dto.classroomIds.length ||
        (dto.scope === 'ALL' && dto.userIds.length)
      ) {
        throw new BadRequestException('ข้อมูลกลุ่มเป้าหมายไม่ถูกต้อง');
      }
      if (dto.scope === 'SELECTED' && !dto.userIds.length) {
        throw new BadRequestException('กรุณาเลือกผู้รับอย่างน้อย 1 คน');
      }
      where = {
        ...(dto.audience === 'TEACHERS'
          ? { role: Role.TEACHER }
          : studentWhere),
        ...(dto.scope === 'SELECTED' ? { id: { in: dto.userIds } } : {}),
      };
    }
    const users = await tx.user.findMany({ where, select: { id: true } });
    if (
      dto.audience !== 'CLASSROOMS' &&
      dto.scope === 'SELECTED' &&
      users.length !== dto.userIds.length
    ) {
      throw new BadRequestException(
        'มีผู้รับที่ไม่อยู่ในกลุ่มเป้าหมาย กรุณาโหลดข้อมูลใหม่',
      );
    }
    if (!users.length)
      throw new BadRequestException('ไม่พบผู้รับในกลุ่มเป้าหมายที่เลือก');
    return users.map((user) => user.id);
  }

  async preview(dto: BroadcastAudienceDto) {
    this.ready();
    const recipients = await this.recipients(this.prisma, dto);
    return { recipientCount: recipients.length };
  }

  async send(senderId: string, dto: SendBroadcastDto) {
    this.ready();
    // A retry of the same draft reuses the unique event keys in the existing
    // inbox and outbox tables. Include the sender and content to isolate drafts.
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          senderId,
          title: dto.title,
          body: dto.body,
          audience: dto.audience,
          scope: dto.scope,
          userIds: [...dto.userIds].sort(),
          classroomIds: [...dto.classroomIds].sort((a, b) => a - b),
        }),
      )
      .digest('hex');
    const eventId = `broadcast:${dto.requestId}:${digest}`;
    const push = pushEnabled();
    // Keep device payloads bounded even for multibyte text; the inbox retains
    // the complete announcement for reading inside the app.
    const bodyCharacters = Array.from(dto.body);
    const pushBody =
      bodyCharacters.length > 250
        ? `${bodyCharacters.slice(0, 250).join('')}…`
        : dto.body;
    return this.prisma.$transaction(
      async (tx) => {
        const userIds = await this.recipients(tx, dto);
        if (userIds.length !== dto.recipientCount) {
          throw new ConflictException(
            'จำนวนผู้รับเปลี่ยนแปลง กรุณาตรวจสอบกลุ่มเป้าหมายอีกครั้ง',
          );
        }
        let inboxCount = 0;
        let queuedDeviceCount = 0;
        for (let offset = 0; offset < userIds.length; offset += 500) {
          const batch = userIds.slice(offset, offset + 500);
          const saved = await tx.notificationInbox.createMany({
            data: batch.map((userId) => ({
              userId,
              eventId,
              kind: 'broadcast',
              title: dto.title,
              body: dto.body,
            })),
            skipDuplicates: true,
          });
          inboxCount += saved.count;
          if (!push) continue;
          const devices = await tx.notificationDevice.findMany({
            where: {
              userId: { in: batch },
              sessionExpiresAt: { gt: new Date() },
            },
            select: { id: true, userId: true, revision: true },
          });
          if (!devices.length) continue;
          const queued = await tx.pushDelivery.createMany({
            data: devices.map((device) => ({
              userId: device.userId,
              deviceId: device.id,
              deviceRevision: device.revision,
              eventId,
              kind: 'broadcast',
              title: dto.title,
              body: pushBody,
            })),
            skipDuplicates: true,
          });
          queuedDeviceCount += queued.count;
        }
        return {
          eventId,
          recipientCount: userIds.length,
          inboxCount,
          queuedDeviceCount,
          pushEnabled: push,
        };
      },
      { timeout: 30000 },
    );
  }
}
