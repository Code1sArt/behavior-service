import { PhotographyLineWorker } from './photography-line.worker';
const job = {
  id: 'job',
  userId: 'student',
  eventId: 'photography:booking:event',
  message: 'งานที่ได้รับมอบหมาย',
  attempts: 0,
};
const prisma = {
  photographyLineDelivery: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: { findUnique: jest.fn() },
};
const line = { sendPushMessage: jest.fn() };
let worker: PhotographyLineWorker;
function lastWrite() {
  return (
    prisma.photographyLineDelivery.updateMany.mock.lastCall as
      | unknown[]
      | undefined
  )?.[0] as {
    where: { id: string; claimId: string };
    data: {
      status: string;
      claimId: string | null;
      leaseUntil: Date | null;
      nextAttemptAt: Date;
    };
  };
}
const saved = {
  enabled: process.env.PHOTOGRAPHY_ENABLED,
  token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
describe('Photography LINE outbox lifecycle', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.PHOTOGRAPHY_ENABLED = 'true';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'fake-never-sent';
    worker = new PhotographyLineWorker(prisma as never, line as never);
    prisma.photographyLineDelivery.findMany.mockResolvedValue([job]);
    prisma.photographyLineDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ lineUserId: 'linked-student' });
    line.sendPushMessage.mockResolvedValue(true);
  });
  afterEach(() => {
    worker.onModuleDestroy();
    for (const [key, value] of [
      ['PHOTOGRAPHY_ENABLED', saved.enabled],
      ['LINE_CHANNEL_ACCESS_TOKEN', saved.token],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  });
  it('does not query unmigrated tables or send when disabled', async () => {
    delete process.env.PHOTOGRAPHY_ENABLED;
    await worker.tick();
    expect(prisma.photographyLineDelivery.findMany).not.toHaveBeenCalled();
    expect(line.sendPushMessage).not.toHaveBeenCalled();
  });
  it('claims a committed job before delivering it and records success', async () => {
    await worker.tick();
    expect(line.sendPushMessage).toHaveBeenCalledWith(
      'linked-student',
      job.message,
    );
    const write = lastWrite();
    expect(write.where.id).toBe('job');
    expect(write.where.claimId).toEqual(expect.any(String));
    expect(write.data.status).toBe('SENT');
    expect(write.data.claimId).toBeNull();
    expect(write.data.leaseUntil).toBeNull();
  });
  it('does not send a job claimed by another process', async () => {
    prisma.photographyLineDelivery.updateMany.mockResolvedValue({ count: 0 });
    await worker.tick();
    expect(line.sendPushMessage).not.toHaveBeenCalled();
  });
  it('retries provider failures and stops after eight attempts', async () => {
    line.sendPushMessage.mockResolvedValue(false);
    await worker.tick();
    expect(lastWrite().data.status).toBe('PENDING');
    expect(lastWrite().data.nextAttemptAt).toBeInstanceOf(Date);
    prisma.photographyLineDelivery.findMany.mockResolvedValue([
      { ...job, attempts: 7 },
    ]);
    await worker.tick();
    expect(lastWrite().data.status).toBe('FAILED');
  });
  it('cancels queued delivery when the user has unlinked LINE', async () => {
    prisma.user.findUnique.mockResolvedValue({ lineUserId: null });
    await worker.tick();
    expect(line.sendPushMessage).not.toHaveBeenCalled();
    expect(lastWrite().data.status).toBe('CANCELLED');
  });
});
