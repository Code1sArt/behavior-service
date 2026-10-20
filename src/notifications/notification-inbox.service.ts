import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const inboxEnabled = () =>
  process.env.IN_APP_NOTIFICATIONS_ENABLED === 'true';

@Injectable()
export class NotificationInboxService {
  constructor(private readonly prisma: PrismaService) {}

  private ready() {
    if (!inboxEnabled())
      throw new ServiceUnavailableException(
        'กล่องแจ้งเตือนยังไม่เปิดให้บริการ',
      );
  }

  async list(userId: string, cursor?: string) {
    this.ready();
    if (
      cursor &&
      !(await this.prisma.notificationInbox.findFirst({
        where: { id: cursor, userId },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException();
    }
    const asOf = new Date();
    const where = { userId, createdAt: { lte: asOf } };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notificationInbox.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 31,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          eventId: true,
          kind: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notificationInbox.count({
        where: { ...where, readAt: null },
      }),
    ]);
    return {
      items: rows.slice(0, 30),
      unreadCount,
      asOf,
      nextCursor: rows.length > 30 ? rows[29].id : null,
    };
  }

  async unread(userId: string) {
    this.ready();
    return {
      unreadCount: await this.prisma.notificationInbox.count({
        where: { userId, readAt: null },
      }),
    };
  }

  async read(userId: string, id: string) {
    this.ready();
    // Keep the first read time stable, and never mutate another user's entry.
    const found = await this.prisma.notificationInbox.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException();
    await this.prisma.notificationInbox.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async readEvent(userId: string, eventId: string) {
    this.ready();
    await this.prisma.notificationInbox.updateMany({
      where: { userId, eventId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  async readAll(userId: string, until: string) {
    this.ready();
    const cutoff = new Date(Math.min(new Date(until).getTime(), Date.now()));
    await this.prisma.notificationInbox.updateMany({
      where: { userId, readAt: null, createdAt: { lte: cutoff } },
      data: { readAt: new Date() },
    });
    return { read: true };
  }
}
