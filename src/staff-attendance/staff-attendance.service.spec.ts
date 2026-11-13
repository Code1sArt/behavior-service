import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Role,
  StaffAttendanceStatus,
  StaffAttendanceType,
} from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StaffAttendanceController } from './staff-attendance.controller';
import { StaffAttendanceService } from './staff-attendance.service';

describe('StaffAttendanceService', () => {
  const createService = (overrides: Record<string, jest.Mock> = {}) => {
    const staffAttendanceNotice = {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
      delete: jest.fn(),
      ...overrides,
    };
    return {
      staffAttendanceNotice,
      service: new StaffAttendanceService({
        staffAttendanceNotice,
        $transaction: jest.fn(
          (
            callback: (tx: {
              staffAttendanceNotice: typeof staffAttendanceNotice;
            }) => unknown,
          ) => Promise.resolve(callback({ staffAttendanceNotice })),
        ),
      } as unknown as PrismaService),
    };
  };

  it('requires an arrival time for a late-arrival request', async () => {
    const { service } = createService();

    await expect(
      service.create('teacher-1', {
        type: StaffAttendanceType.LATE_ARRIVAL,
        startDate: '2026-11-13',
        endDate: '2026-11-13',
        reason: 'รถเสีย',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a notice overlapping an existing date range', async () => {
    const { service } = createService({
      findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
    });

    await expect(
      service.create('teacher-1', {
        type: StaffAttendanceType.SICK_LEAVE,
        startDate: '2026-11-13',
        endDate: '2026-11-15',
        reason: 'มีไข้',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns daily totals split by notice type', async () => {
    const startDate = new Date('2026-11-13T00:00:00.000Z');
    const endDate = new Date('2026-11-15T00:00:00.000Z');
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
          status: StaffAttendanceStatus.APPROVED,
          startDate,
          endDate,
          arrivalTime: null,
          reason: 'ติดต่อราชการ',
          teacherId: teacher.id,
          teacher,
          createdAt: startDate,
          updatedAt: startDate,
        },
        {
          id: '2',
          type: StaffAttendanceType.LATE_ARRIVAL,
          status: StaffAttendanceStatus.APPROVED,
          startDate,
          endDate: startDate,
          arrivalTime: '09:00',
          reason: 'รถติด',
          teacherId: 'teacher-2',
          teacher: { ...teacher, id: 'teacher-2' },
          createdAt: startDate,
          updatedAt: startDate,
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
    expect(result.records[0].startDate).toBe('2026-11-13');
    expect(result.records[0].endDate).toBe('2026-11-15');
    expect(staffAttendanceNotice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          startDate: { lte: startDate },
          endDate: { gte: startDate },
          status: StaffAttendanceStatus.APPROVED,
        },
      }),
    );
  });

  it('calculates fiscal-year leave days using the October 30 cutoff', async () => {
    const { service } = createService({
      findMany: jest.fn().mockResolvedValue([
        {
          id: '1',
          type: StaffAttendanceType.SICK_LEAVE,
          status: StaffAttendanceStatus.APPROVED,
          startDate: new Date('2026-10-29T00:00:00.000Z'),
          endDate: new Date('2026-11-02T00:00:00.000Z'),
          arrivalTime: null,
          reason: 'พักรักษาตัว',
          teacherId: 'teacher-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    });

    const result = await service.getMyStatistics('teacher-1', {
      scope: 'FISCAL_YEAR',
      fiscalYear: 2026,
    });

    expect(result.period).toEqual({
      fiscalYear: 2026,
      fiscalYearBuddhist: 2569,
      startDate: '2025-10-31',
      endDate: '2026-10-30',
    });
    expect(result.sickLeave).toEqual({ requests: 1, days: 2 });
    expect(result.totals).toEqual({
      requests: 1,
      approvedRequests: 1,
      pendingRequests: 0,
      rejectedRequests: 0,
      leaveDays: 2,
    });
  });

  it('records an executive decision on a pending notice', async () => {
    const notice = {
      id: 'notice-1',
      type: StaffAttendanceType.PERSONAL_LEAVE,
      status: StaffAttendanceStatus.APPROVED,
      startDate: new Date('2026-11-13T00:00:00.000Z'),
      endDate: new Date('2026-11-14T00:00:00.000Z'),
      arrivalTime: null,
      reason: 'ติดต่อราชการ',
      teacherId: 'teacher-1',
      reviewerId: 'executive-1',
      reviewNote: 'อนุมัติ',
      reviewedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { service, staffAttendanceNotice } = createService({
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ status: StaffAttendanceStatus.PENDING })
        .mockResolvedValueOnce(notice),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    });

    const result = await service.review('notice-1', 'executive-1', {
      status: StaffAttendanceStatus.APPROVED,
      reviewNote: 'อนุมัติ',
    });

    expect(result.status).toBe(StaffAttendanceStatus.APPROVED);
    expect(staffAttendanceNotice.updateMany).toHaveBeenCalledWith({
      where: { id: 'notice-1', status: StaffAttendanceStatus.PENDING },
      data: expect.objectContaining({
        status: StaffAttendanceStatus.APPROVED,
        reviewerId: 'executive-1',
        reviewNote: 'อนุมัติ',
      }),
    });
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

  it('allows only executives to approve or reject notices', () => {
    const handler = Object.getOwnPropertyDescriptor(
      StaffAttendanceController.prototype,
      'review',
    )?.value as object;

    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.EXECUTIVE]);
  });

  it('allows only administrators to delete notices', () => {
    const handler = Object.getOwnPropertyDescriptor(
      StaffAttendanceController.prototype,
      'remove',
    )?.value as object;

    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([Role.ADMIN]);
  });
});
