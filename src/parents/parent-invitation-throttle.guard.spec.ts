import type { ExecutionContext } from '@nestjs/common';
import { ParentInvitationThrottleGuard } from './parent-invitation-throttle.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('parent invitation lookup limits', () => {
  it('uses persistent counters with hashed IP addresses and rejects excess requests', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValueOnce({ count: 120 })
      .mockResolvedValueOnce({ count: 121 });
    const guard = new ParentInvitationThrottleGuard({
      emailOtpBucket: { upsert },
    } as unknown as PrismaService);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ ip: '192.0.2.1' }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(upsert.mock.calls[0][0].where.key).not.toContain('192.0.2.1');
    expect(upsert.mock.calls[0][0].update).toEqual({ count: { increment: 1 } });
  });
});
