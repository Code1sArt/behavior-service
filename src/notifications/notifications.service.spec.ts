import { NotificationsService } from './notifications.service';
import { createHash } from 'node:crypto';

const prisma = {
  notificationDevice: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
  pushDelivery: { createMany: jest.fn() },
  notificationInbox: { createMany: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
};
const service = new NotificationsService(prisma as never);

describe('native push registration and transactional outbox', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.PUSH_ENABLED = 'true';
    prisma.user.findUnique.mockResolvedValue({
      id: 'student',
      firstName: 'นักเรียน',
      lastName: 'ทดสอบ',
      parentId: 'parent',
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'teacher' }]);
    prisma.notificationDevice.findMany.mockResolvedValue([
      { id: 'device', userId: 'parent', revision: 3 },
    ]);
  });
  afterEach(() => {
    delete process.env.IN_APP_NOTIFICATIONS_ENABLED;
    delete process.env.PUSH_ENABLED;
  });

  it('records inbox events without a registered device or native push enabled', async () => {
    delete process.env.PUSH_ENABLED;
    process.env.IN_APP_NOTIFICATIONS_ENABLED = 'true';
    await service.enqueueStudent(
      prisma as never,
      'student',
      'behavior',
      'same-event',
      1,
    );
    expect(prisma.notificationInbox.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'student', eventId: 'same-event', kind: 'behavior' },
        { userId: 'parent', eventId: 'same-event', kind: 'behavior' },
        { userId: 'teacher', eventId: 'same-event', kind: 'behavior' },
      ],
      skipDuplicates: true,
    });
    expect(prisma.pushDelivery.createMany).not.toHaveBeenCalled();
    expect(prisma.notificationDevice.findMany).not.toHaveBeenCalled();
  });

  it('persists the same named event snapshot for inbox and every device', async () => {
    process.env.IN_APP_NOTIFICATIONS_ENABLED = 'true';
    await service.enqueueStudent(
      prisma as never,
      'student',
      'behavior',
      'detail-event',
      undefined,
      {
        title: 'หักคะแนน',
        body: 'หักคะแนน 3 คะแนน · แต่งกายผิดระเบียบ',
      },
    );
    const content = {
      title: 'หักคะแนน',
      body: 'นักเรียน ทดสอบ · หักคะแนน 3 คะแนน · แต่งกายผิดระเบียบ',
    };
    expect(prisma.notificationInbox.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: 'student', ...content }),
      expect.objectContaining({ userId: 'parent', ...content }),
    ]);
    expect(prisma.pushDelivery.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: 'parent', ...content }),
    ]);
  });

  it('is disabled by default and writes no registrations or outbox', async () => {
    delete process.env.IN_APP_NOTIFICATIONS_ENABLED;
    delete process.env.PUSH_ENABLED;
    await expect(
      service.register('user', new Date(Date.now() + 100000), {
        token: 'secret-token',
        platform: 'ios',
      }),
    ).rejects.toThrow();
    await service.enqueueStudent(
      prisma as never,
      'student',
      'behavior',
      'event',
    );
    expect(prisma.notificationDevice.upsert).not.toHaveBeenCalled();
    expect(prisma.pushDelivery.createMany).not.toHaveBeenCalled();
  });
  it('reassigns a token to the authenticated owner and invalidates old delivery snapshots', async () => {
    const expiry = new Date(Date.now() + 100000);
    await service.register('new-owner', expiry, {
      token: 'secret-token',
      platform: 'ios',
    });
    expect(prisma.notificationDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: createHash('sha256').update('secret-token').digest('hex'),
        },
        update: expect.objectContaining({
          userId: 'new-owner',
          sessionExpiresAt: expiry,
          revision: { increment: 1 },
        }),
      }),
    );
  });
  it('never deletes a registration owned by another account', async () => {
    await service.remove('owner', 'secret-token');
    expect(prisma.notificationDevice.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner',
        tokenHash: createHash('sha256').update('secret-token').digest('hex'),
      },
    });
  });
  it('queues family and advisors without requiring LINE IDs', async () => {
    await service.enqueueStudent(
      prisma as never,
      'student',
      'behavior',
      'event',
      10,
    );
    expect(prisma.notificationDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: { in: ['student', 'parent', 'teacher'] },
          sessionExpiresAt: { gt: expect.any(Date) },
        },
      }),
    );
    expect(prisma.pushDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventId: 'event',
          deviceId: 'device',
          userId: 'parent',
          deviceRevision: 3,
          kind: 'behavior',
        }),
      ],
      skipDuplicates: true,
    });
  });
  it('uses the caller transaction and excludes advisors from ordinary family events', async () => {
    await service.enqueueStudent(
      prisma as never,
      'student',
      'attendance',
      'event',
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.pushDelivery.createMany).toHaveBeenCalledTimes(1);
  });
});
