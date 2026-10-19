import { PushWorker } from './push.worker';

const job = {
  id: 'job',
  deviceId: 'device',
  userId: 'user',
  deviceRevision: 1,
  eventId: 'event',
  kind: 'behavior',
  attempts: 0,
};
const device = {
  id: 'device',
  userId: 'user',
  revision: 1,
  token: 'private-token',
};
const prisma = {
  pushDelivery: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  notificationDevice: { findFirst: jest.fn(), deleteMany: jest.fn() },
};
const sender = { send: jest.fn() };
let worker: PushWorker;

describe('push worker delivery lifecycle', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.PUSH_ENABLED = 'true';
    worker = new PushWorker(prisma as never, sender as never);
    prisma.pushDelivery.findMany.mockResolvedValue([job]);
    prisma.pushDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.notificationDevice.findFirst.mockResolvedValue(device);
  });
  afterEach(() => {
    worker.onModuleDestroy();
    delete process.env.PUSH_ENABLED;
  });

  it('does not initialize Firebase or touch the database while disabled', async () => {
    delete process.env.PUSH_ENABLED;
    await worker.tick();
    expect(prisma.pushDelivery.findMany).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
  });
  it('sends once after an atomic claim and records success', async () => {
    await worker.tick();
    expect(sender.send).toHaveBeenCalledWith(
      'private-token',
      'behavior',
      'event',
    );
    expect(prisma.pushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
  });
  it('skips a job already claimed by another process', async () => {
    prisma.pushDelivery.updateMany.mockResolvedValue({ count: 0 });
    await worker.tick();
    expect(sender.send).not.toHaveBeenCalled();
  });
  it('cancels queued alerts after logout, account switch or session expiry', async () => {
    prisma.notificationDevice.findFirst.mockResolvedValue(null);
    await worker.tick();
    expect(sender.send).not.toHaveBeenCalled();
    expect(prisma.notificationDevice.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'device',
        userId: 'user',
        revision: 1,
        sessionExpiresAt: { gt: expect.any(Date) },
      },
    });
    expect(prisma.pushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });
  it('retries transient failures without storing the provider message or token', async () => {
    sender.send.mockRejectedValue(
      Object.assign(new Error('contains-private-token'), {
        code: 'messaging/server-unavailable',
      }),
    );
    await worker.tick();
    expect(prisma.pushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING',
          lastError: 'messaging/server-unavailable',
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });
  it('removes invalid tokens only if the registration revision still matches', async () => {
    sender.send.mockRejectedValue({
      code: 'messaging/registration-token-not-registered',
    });
    await worker.tick();
    expect(prisma.notificationDevice.deleteMany).toHaveBeenCalledWith({
      where: { id: 'device', userId: 'user', revision: 1 },
    });
  });
  it('stops retrying after the eighth attempt', async () => {
    prisma.pushDelivery.findMany.mockResolvedValue([{ ...job, attempts: 7 }]);
    sender.send.mockRejectedValue({ code: 'messaging/server-unavailable' });
    await worker.tick();
    expect(prisma.pushDelivery.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
