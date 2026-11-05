import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from '../line/line.service';

@Injectable()
export class PhotographyLineWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(PhotographyLineWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LineService,
  ) {}
  onModuleInit() {
    if (
      process.env.PHOTOGRAPHY_ENABLED !== 'true' ||
      !process.env.LINE_CHANNEL_ACCESS_TOKEN
    )
      return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 10000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (
      this.running ||
      process.env.PHOTOGRAPHY_ENABLED !== 'true' ||
      !process.env.LINE_CHANNEL_ACCESS_TOKEN
    )
      return;
    this.running = true;
    try {
      const now = new Date();
      const ready = {
        OR: [
          { status: 'PENDING', nextAttemptAt: { lte: now } },
          { status: 'SENDING', leaseUntil: { lt: now } },
        ],
      };
      const jobs = await this.prisma.photographyLineDelivery.findMany({
        where: ready,
        take: 20,
        orderBy: { createdAt: 'asc' },
      });
      for (const job of jobs) {
        const claimId = randomUUID();
        const claimed = await this.prisma.photographyLineDelivery.updateMany({
          where: { id: job.id, ...ready },
          data: {
            status: 'SENDING',
            claimId,
            leaseUntil: new Date(Date.now() + 120000),
            attempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) continue;
        const user = await this.prisma.user.findUnique({
          where: { id: job.userId },
          select: { lineUserId: true },
        });
        const sent = user?.lineUserId
          ? await this.line.sendPushMessage(user.lineUserId, job.message)
          : false;
        const attempts = job.attempts + 1;
        await this.prisma.photographyLineDelivery.updateMany({
          where: { id: job.id, claimId },
          data: {
            status: !user?.lineUserId
              ? 'CANCELLED'
              : sent
                ? 'SENT'
                : attempts >= 8
                  ? 'FAILED'
                  : 'PENDING',
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600, 15 * 2 ** attempts) * 1000,
            ),
            claimId: null,
            leaseUntil: null,
          },
        });
      }
      await this.prisma.photographyLineDelivery.deleteMany({
        where: {
          status: { in: ['SENT', 'FAILED', 'CANCELLED'] },
          createdAt: { lt: new Date(Date.now() - 30 * 86400000) },
        },
      });
    } catch {
      this.logger.error(
        'Photography LINE worker failed; queued jobs will be retried',
      );
    } finally {
      this.running = false;
    }
  }
}
