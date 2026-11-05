import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@prisma/client';
import { PhotographyService } from './photography.service';
import { PhotographyCalendarQuery } from './photography.dto';

const actor = { userId: 'teacher', role: Role.TEACHER };
const slot = {
  id: 'slot',
  startsAt: new Date('2030-01-31T16:00:00Z'),
  endsAt: new Date('2030-02-01T03:00:00Z'),
  booking: { kind: 'PHOTOGRAPHERS', status: 'PENDING' },
};

describe('Shared photography calendar', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    photographyBookingSlot: { findMany: jest.fn() },
  };
  const service = new PhotographyService(prisma as never, {} as never);
  const previous = process.env.PHOTOGRAPHY_ENABLED;
  beforeEach(() => {
    process.env.PHOTOGRAPHY_ENABLED = 'true';
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ role: Role.TEACHER });
    prisma.photographyBookingSlot.findMany.mockResolvedValue([slot]);
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.PHOTOGRAPHY_ENABLED;
    else process.env.PHOTOGRAPHY_ENABLED = previous;
  });

  it.each([
    ['2030-02', '2030-01-31T17:00:00.000Z', '2030-02-28T17:00:00.000Z'],
    ['2032-02', '2032-01-31T17:00:00.000Z', '2032-02-29T17:00:00.000Z'],
    ['2030-12', '2030-11-30T17:00:00.000Z', '2030-12-31T17:00:00.000Z'],
  ])(
    'includes slots overlapping Bangkok month %s, across all requesters',
    async (month, from, to) => {
      const result = await service.calendar(actor, { month });
      expect(prisma.photographyBookingSlot.findMany).toHaveBeenCalledWith({
        where: {
          startsAt: { lt: new Date(to) },
          endsAt: { gt: new Date(from) },
          booking: { status: { in: ['PENDING', 'APPROVED'] } },
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          booking: { select: { kind: true, status: true } },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      });
      expect(result).toEqual([
        {
          id: slot.id,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          ...slot.booking,
        },
      ]);
    },
  );

  it.each([Role.PARENT, Role.STUDENT])(
    'rejects calendar access for %s',
    async (role) => {
      prisma.user.findUnique.mockResolvedValue({ role });
      await expect(
        service.calendar({ userId: 'other', role }, { month: '2030-02' }),
      ).rejects.toThrow();
      expect(prisma.photographyBookingSlot.findMany).not.toHaveBeenCalled();
    },
  );

  it('honors the photography feature flag', async () => {
    process.env.PHOTOGRAPHY_ENABLED = 'false';
    await expect(
      service.calendar(actor, { month: '2030-02' }),
    ).rejects.toThrow();
    expect(prisma.photographyBookingSlot.findMany).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    '',
    '0000-01',
    '2030-13',
    '2030-00',
    '2030-2',
    '2030-02-01',
    ['2030-02'],
  ])('rejects invalid month %p', async (month) => {
    const query = plainToInstance(PhotographyCalendarQuery, { month });
    expect(await validate(query)).not.toHaveLength(0);
  });
});
