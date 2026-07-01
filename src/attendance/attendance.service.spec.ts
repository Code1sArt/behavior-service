import { BadRequestException } from '@nestjs/common';
import { AttendanceStatus, AttendanceType } from '@prisma/client';
import { AcademicCalendarService } from '../academic-calendar/academic-calendar.service';
import { LineService } from '../line/line.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  const findActiveTerm = jest.fn();
  const getSchoolDayStatus = jest.fn();
  const findClassrooms = jest.fn();
  const findAttendanceRecords = jest.fn();
  const prisma = {
    academicTerm: { findFirst: findActiveTerm },
    classroom: { findMany: findClassrooms },
    attendanceRecord: { findMany: findAttendanceRecords },
  } as unknown as PrismaService;
  const lineService = {} as LineService;
  const academicCalendarService = {
    getSchoolDayStatus,
  } as unknown as AcademicCalendarService;
  const service = new AttendanceService(
    prisma,
    lineService,
    academicCalendarService,
  );
  const dto = {
    type: AttendanceType.ASSEMBLY,
    records: [{ studentId: 'student-1', status: AttendanceStatus.PRESENT }],
  };

  beforeEach(() => {
    findActiveTerm.mockReset();
    getSchoolDayStatus.mockReset();
    findClassrooms.mockReset();
    findAttendanceRecords.mockReset();
  });

  it('rejects attendance when there is no active term', async () => {
    findActiveTerm.mockResolvedValue(null);

    await expect(service.recordBulk('recorder-1', dto)).rejects.toThrow(
      new BadRequestException('ไม่พบเทอมปัจจุบัน'),
    );
    expect(getSchoolDayStatus).not.toHaveBeenCalled();
  });

  it('rejects attendance when today is not a school day', async () => {
    findActiveTerm.mockResolvedValue({ id: 1 });
    getSchoolDayStatus.mockResolvedValue({
      isSchoolDay: false,
      reason: 'WEEKEND',
    });

    await expect(service.recordBulk('recorder-1', dto)).rejects.toThrow(
      'ไม่สามารถเช็คชื่อได้ เนื่องจากวันนี้ไม่ใช่วันเรียน (WEEKEND)',
    );
    expect(getSchoolDayStatus).toHaveBeenCalledWith(1, expect.anything());
  });

  it('returns an empty missing report when the date is not a school day', async () => {
    findActiveTerm.mockResolvedValue({ id: 1 });
    getSchoolDayStatus.mockResolvedValue({
      isSchoolDay: false,
      reason: 'WEEKEND',
    });

    await expect(
      service.getMissingAttendanceClassrooms('2026-06-20'),
    ).resolves.toEqual({
      targetDate: '2026-06-20',
      isSchoolDay: false,
      reason: 'WEEKEND',
      summary: {
        totalClassrooms: 0,
        missingAssembly: 0,
        missingArea: 0,
      },
      details: [],
    });
  });

  it('returns the first names of all classroom advisors', async () => {
    findActiveTerm.mockResolvedValue({ id: 1 });
    getSchoolDayStatus.mockResolvedValue({
      isSchoolDay: true,
      reason: null,
    });
    findClassrooms.mockResolvedValue([
      {
        id: 1,
        name: 'ม.1/1',
        advisors: [
          { firstName: 'สมชาย', lastName: 'ใจดี', lineUserId: null },
          { firstName: 'สมศรี', lastName: 'ใจงาม', lineUserId: null },
        ],
        students: [{ id: 'student-1' }],
      },
    ]);
    findAttendanceRecords.mockResolvedValue([]);

    const result = await service.getMissingAttendanceClassrooms('2026-06-22');

    expect(result.details[0].advisorName).toBe('สมชาย, สมศรี');
  });

  it('skips LINE notifications when the date is not a school day', async () => {
    findActiveTerm.mockResolvedValue({ id: 1 });
    getSchoolDayStatus.mockResolvedValue({
      isSchoolDay: false,
      reason: 'วันหยุดพิเศษ',
    });

    await expect(service.sendLineNotification('2026-06-22')).resolves.toEqual({
      success: true,
      skipped: true,
      reason: 'วันหยุดพิเศษ',
      message: 'ข้ามการส่งแจ้งเตือน เนื่องจากไม่ใช่วันเรียน',
      count: 0,
    });
  });

  it('returns an empty daily summary when the date is not a school day', async () => {
    findActiveTerm.mockResolvedValue({ id: 1 });
    getSchoolDayStatus.mockResolvedValue({
      isSchoolDay: false,
      reason: 'OUTSIDE_TERM',
    });

    await expect(
      service.getDailySummary('2026-05-31', undefined, AttendanceType.ASSEMBLY),
    ).resolves.toEqual({
      date: '2026-05-31',
      type: AttendanceType.ASSEMBLY,
      isSchoolDay: false,
      reason: 'OUTSIDE_TERM',
      summary: [],
    });
  });

  it('returns an empty daily history when the date is not a school day', async () => {
    findActiveTerm.mockResolvedValue({ id: 1 });
    getSchoolDayStatus.mockResolvedValue({
      isSchoolDay: false,
      reason: 'วันหยุดพิเศษ',
    });

    await expect(service.getDailyHistory('2026-06-22')).resolves.toEqual({
      date: '2026-06-22',
      isSchoolDay: false,
      reason: 'วันหยุดพิเศษ',
      records: {
        ASSEMBLY: [],
        AREA: [],
      },
    });
  });
});
