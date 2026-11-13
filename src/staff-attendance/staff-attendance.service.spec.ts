import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role, StaffAttendanceType } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StaffAttendanceController } from './staff-attendance.controller';
import { StaffAttendanceService } from './staff-attendance.service';

describe('StaffAttendanceService', () => {
  const createService = (overrides: Record<string, jest.Mock> = {}) => {
    const staffAttendanceNotice = {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
    return {
      staffAttendanceNotice,
      service: new StaffAttendanceService({
        staffAttendanceNotice,
      } as unknown as PrismaService),
    };
  };

  it('requires an arrival time for a late-arrival request', async () => {
    const { service } = createService();

    await expect(
      service.create('teacher-1', {
        type: StaffAttendanceType.LATE_ARRIVAL,
        date: '2026-11-13',
        reason: 'รถเสีย',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a second notice from the same teacher on the same date', async () => {
    const { service } = createService({
      findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
    });

    await expect(
      service.create('teacher-1', {
        type: StaffAttendanceType.SICK_LEAVE,
        date: '2026-11-13',
        reason: 'มีไข้',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns daily totals split by notice type', async () => {
    const date = new Date('2026-11-13T00:00:00.000Z');
    const teacher = {
      id: 'teacher-1',
      citizenId: '1234567890123',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
    };
    const { service, staffAttendanceNotice } = createService({
      findMany: jest.fn().mockResolvedValue([
        {
          id: '1',
          type: StaffAttendanceType.PERSONAL_LEAVE,
          date,
          arrivalTime: null,
          reason: 'ติดต่อราชการ',
          teacherId: teacher.id,
          teacher,
          createdAt: date,
          updatedAt: date,
        },
        {
          id: '2',
          type: StaffAttendanceType.LATE_ARRIVAL,
          date,
          arrivalTime: '09:00',
          reason: 'รถติด',
          teacherId: 'teacher-2',
          teacher: { ...teacher, id: 'teacher-2' },
          createdAt: date,
          updatedAt: date,
        },
      ]),
    });

    const result = await service.getDailySummary('2026-11-13');

    expect(result.totals).toEqual({
      total: 2,
      personalLeave: 1,
      sickLeave: 0,
      lateArrival: 1,
    });
    expect(result.records[0].date).toBe('2026-11-13');
    expect(staffAttendanceNotice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { date } }),
    );
  });

  it('allows only administrators and executives to read the daily summary', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      StaffAttendanceController.prototype,
      'getDailySummary',
    );
    const handler = descriptor?.value as unknown;
    expect(typeof handler).toBe('function');
    const roles: unknown = Reflect.getMetadata(ROLES_KEY, handler as object);

    expect(roles).toEqual([Role.ADMIN, Role.EXECUTIVE]);
  });
});
