import { Role } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PhotographyService } from './photography.service';

describe('Admin photography deletion permissions', () => {
  const prisma = {
    $transaction: jest.fn(),
    photographyMutex: { update: jest.fn() },
    user: { findUnique: jest.fn() },
    photographyBooking: { findUnique: jest.fn(), delete: jest.fn() },
    photographyLineDelivery: { deleteMany: jest.fn() },
    pushDelivery: { deleteMany: jest.fn() },
    notificationInbox: { deleteMany: jest.fn() },
  };
  const service = new PhotographyService(prisma as never, {} as never);
  const saved = process.env.PHOTOGRAPHY_ENABLED;
  beforeEach(() => {
    process.env.PHOTOGRAPHY_ENABLED = 'true';
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (action: (tx: typeof prisma) => Promise<unknown>) => action(prisma),
    );
    prisma.user.findUnique.mockResolvedValue({ role: Role.ADMIN });
    prisma.photographyBooking.findUnique.mockResolvedValue({ id: 'booking' });
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.PHOTOGRAPHY_ENABLED;
    else process.env.PHOTOGRAPHY_ENABLED = saved;
  });
  it.each([Role.TEACHER, Role.AFFAIRS, Role.STUDENT, Role.PARENT])(
    'rejects a stale admin JWT when the current role is %s',
    async (role) => {
      prisma.user.findUnique.mockResolvedValue({
        role,
        photographyManager: { userId: 'user' },
      });
      await expect(
        service.remove({ userId: 'user', role: Role.ADMIN }, 'booking'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.photographyBooking.findUnique).not.toHaveBeenCalled();
      expect(prisma.photographyBooking.delete).not.toHaveBeenCalled();
      expect(prisma.notificationInbox.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('returns 404 for a missing booking without deleting notifications', async () => {
    prisma.photographyBooking.findUnique.mockResolvedValue(null);
    await expect(
      service.remove({ userId: 'user', role: Role.ADMIN }, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.photographyLineDelivery.deleteMany).not.toHaveBeenCalled();
    expect(prisma.photographyBooking.delete).not.toHaveBeenCalled();
  });
  it('checks the feature flag before starting a transaction', () => {
    process.env.PHOTOGRAPHY_ENABLED = 'false';
    expect(() =>
      service.remove({ userId: 'user', role: Role.ADMIN }, 'booking'),
    ).toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
