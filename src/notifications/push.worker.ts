import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FirebasePushSender } from './firebase-push.sender';
import { pushEnabled, PushKind } from './notifications.service';

@Injectable()
export class PushWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(PushWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: FirebasePushSender,
  ) {}
  onModuleInit() {
    if (!pushEnabled()) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 10000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (!pushEnabled() || this.running) return;
    this.running = true;
    try {
      const now = new Date();
      // An in-flight send may be retried after a crash. FCM delivery is at least once.
      const ready = {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'SENDING', leaseUntil: { lt: now } },
        ],
      };
      const jobs = await this.prisma.pushDelivery.findMany({
        where: ready,
        take: 50,
        orderBy: { createdAt: 'asc' },
      });
      for (const job of jobs) {
        const claimId = randomUUID();
        const claim = await this.prisma.pushDelivery.updateMany({
          where: { id: job.id, ...ready },
          data: {
            status: 'SENDING',
            claimId,
            leaseUntil: new Date(Date.now() + 120000),
            attempts: { increment: 1 },
          },
        });
        if (claim.count !== 1) continue;
        const where = { id: job.id, claimId };
        const device = await this.prisma.notificationDevice.findFirst({
          where: {
            id: job.deviceId,
            userId: job.userId,
            revision: job.deviceRevision,
            sessionExpiresAt: { gt: new Date() },
          },
        });
        if (!device) {
          await this.prisma.pushDelivery.updateMany({
            where,
            data: { status: 'CANCELLED', claimId: null, leaseUntil: null },
          });
          continue;
        }
        try {
          await this.sender.send(
            device.token,
            job.kind as PushKind,
            job.eventId,
          );
          await this.prisma.pushDelivery.updateMany({
            where,
            data: {
              status: 'SENT',
              sentAt: new Date(),
              claimId: null,
              leaseUntil: null,
              lastError: null,
            },
          });
        } catch (error) {
          const code =
            typeof (error as { code?: unknown })?.code === 'string'
              ? (error as { code: string }).code
              : 'push/send-failed';
          const invalid = [
            'messaging/registration-token-not-registered',
            'messaging/invalid-registration-token',
          ].includes(code);
          const attempts = job.attempts + 1;
          await this.prisma.pushDelivery.updateMany({
            where,
            data: {
              status: invalid || attempts >= 8 ? 'FAILED' : 'PENDING',
              lastError: code.slice(0, 191),
              nextAttemptAt: new Date(
                Date.now() + Math.min(3600, 15 * 2 ** attempts) * 1000,
              ),
              claimId: null,
              leaseUntil: null,
            },
          });
          if (invalid)
            await this.prisma.notificationDevice.deleteMany({
              where: {
                id: device.id,
                userId: device.userId,
                revision: device.revision,
              },
            });
        }
      }
      // A stale client cannot keep receiving notifications after its JWT expires.
      await this.prisma.notificationDevice.deleteMany({
        where: { sessionExpiresAt: { lte: new Date() } },
      });
      await this.prisma.pushDelivery.deleteMany({
        where: {
          status: { in: ['SENT', 'FAILED', 'CANCELLED'] },
          createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
        },
      });
    } catch {
      // Do not log tokens, credentials, payloads, or arbitrary provider error messages.
      this.logger.error('Push worker failed; queued jobs will be retried');
    } finally {
      this.running = false;
    }
  }
}
