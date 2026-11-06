import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ParentInvitationThrottleGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const minute = Math.floor(Date.now() / 60_000);
    const key = `parent-link:${createHash('sha256').update(ip).digest('hex')}:${minute}`;
    const bucket = await this.prisma.emailOtpBucket.upsert({
      where: { key },
      create: { key, count: 1, expiresAt: new Date((minute + 2) * 60_000) },
      update: { count: { increment: 1 } },
    });
    if (bucket.count > 120)
      throw new HttpException(
        'ตรวจสอบรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
        429,
      );
    return true;
  }
}
