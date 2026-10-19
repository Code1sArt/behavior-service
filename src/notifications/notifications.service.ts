import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './device.dto';

export type PushKind = 'behavior' | 'attendance';
export const pushEnabled = () => process.env.PUSH_ENABLED === 'true';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    userId: string,
    sessionExpiresAt: Date,
    dto: RegisterDeviceDto,
  ) {
    if (!pushEnabled())
      throw new ServiceUnavailableException('Push is not enabled');
    if (sessionExpiresAt.getTime() <= Date.now())
      throw new ServiceUnavailableException('Session expired');
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    await this.prisma.notificationDevice.upsert({
      where: { tokenHash },
      create: {
        tokenHash,
        token: dto.token,
        userId,
        platform: dto.platform,
        sessionExpiresAt,
      },
      update: {
        token: dto.token,
        userId,
        platform: dto.platform,
        sessionExpiresAt,
        revision: { increment: 1 },
      },
    });
    return { registered: true };
  }

  async remove(userId: string, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.notificationDevice.deleteMany({
      where: { userId, tokenHash },
    });
    return { registered: false };
  }

  // Always call using the same transaction as the business write. Workers only see committed rows.
  async enqueueStudent(
    tx: Prisma.TransactionClient,
    studentId: string,
    kind: PushKind,
    eventId: string,
    advisorClassroomId?: number,
  ) {
    if (!pushEnabled()) return;
    const student = await tx.user.findUnique({
      where: { id: studentId },
      select: { id: true, parentId: true },
    });
    if (!student) return;
    const recipientIds = new Set([
      student.id,
      ...(student.parentId ? [student.parentId] : []),
    ]);
    if (advisorClassroomId !== undefined) {
      const advisors = await tx.user.findMany({
        where: {
          role: Role.TEACHER,
          advisingClasses: { some: { id: advisorClassroomId } },
        },
        select: { id: true },
      });
      advisors.forEach((user) => recipientIds.add(user.id));
    }
    const devices = await tx.notificationDevice.findMany({
      where: {
        userId: { in: [...recipientIds] },
        sessionExpiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true, revision: true },
    });
    if (devices.length === 0) return;
    await tx.pushDelivery.createMany({
      data: devices.map((device) => ({
        id: randomUUID(),
        eventId,
        kind,
        deviceId: device.id,
        userId: device.userId,
        deviceRevision: device.revision,
      })),
      skipDuplicates: true,
    });
  }
}
