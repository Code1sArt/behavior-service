import { NotFoundException } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicCalendarService } from './academic-calendar.service';

describe('AcademicCalendarService', () => {
  const findUnique = jest.fn();
  const prisma = {
    academicTerm: { findUnique },
  } as unknown as PrismaService;
  const service = new AcademicCalendarService(prisma);

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('throws when the term does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.getSchoolDayStatus(1, dayjs('2026-06-23')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['2026-05-31', 'OUTSIDE_TERM'],
    ['2026-11-01', 'OUTSIDE_TERM'],
    ['2026-06-20', 'WEEKEND'],
    ['2026-06-22', 'วันหยุดพิเศษ'],
  ])('returns the reason for %s', async (date, reason) => {
    findUnique.mockResolvedValue({
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-10-31'),
      holidays: [{ date: new Date('2026-06-22'), name: 'วันหยุดพิเศษ' }],
    });

    await expect(service.getSchoolDayStatus(1, dayjs(date))).resolves.toEqual({
      isSchoolDay: false,
      reason,
    });
  });

  it('returns a school day for a weekday without a holiday', async () => {
    findUnique.mockResolvedValue({
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-10-31'),
      holidays: [],
    });

    await expect(
      service.getSchoolDayStatus(1, dayjs('2026-06-23')),
    ).resolves.toEqual({
      isSchoolDay: true,
      reason: null,
    });
  });
});
