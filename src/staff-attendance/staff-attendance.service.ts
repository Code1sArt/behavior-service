import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StaffAttendanceStatus,
  StaffAttendanceType,
} from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStaffAttendanceDto,
  StaffAttendanceHistoryQueryDto,
  StaffAttendanceManagementQueryDto,
  StaffAttendanceStatisticsQueryDto,
  ReviewStaffAttendanceDto,
} from './dto/create-staff-attendance.dto';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class StaffAttendanceService {
  private readonly timezone = 'Asia/Bangkok';

  constructor(private readonly prisma: PrismaService) {}

  private parseDate(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
      throw new BadRequestException('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD');

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException('วันที่ไม่ถูกต้อง');
    }
    return parsed;
  }

  private dateText(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private serialize<T extends { startDate: Date; endDate: Date }>(notice: T) {
    return {
      ...notice,
      startDate: this.dateText(notice.startDate),
      endDate: this.dateText(notice.endDate),
    };
  }

  private inclusiveDays(startDate: Date, endDate: Date) {
    return (
      Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    );
  }

  private fiscalPeriod(requestedYear?: number) {
    const now = dayjs().tz(this.timezone);
    const currentYear = now.year();
    const currentCutoff = this.parseDate(`${currentYear}-10-30`);
    const today = this.parseDate(now.format('YYYY-MM-DD'));
    let fiscalYear =
      requestedYear ?? (today <= currentCutoff ? currentYear : currentYear + 1);
    if (fiscalYear >= 2400) fiscalYear -= 543;
    if (fiscalYear < 1900 || fiscalYear > 2500) {
      throw new BadRequestException('ปีงบประมาณไม่ถูกต้อง');
    }
    return {
      fiscalYear,
      startDate: this.parseDate(`${fiscalYear - 1}-10-31`),
      endDate: this.parseDate(`${fiscalYear}-10-30`),
    };
  }

  async create(teacherId: string, dto: CreateStaffAttendanceDto) {
    const startDate = this.parseDate(dto.startDate);
    const endDate = this.parseDate(dto.endDate);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผล');
    if (startDate > endDate) {
      throw new BadRequestException('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
    }

    if (dto.type === StaffAttendanceType.LATE_ARRIVAL && !dto.arrivalTime) {
      throw new BadRequestException(
        'กรุณาระบุเวลาที่คาดว่าจะมาถึงเมื่อขออนุญาตเข้าสาย',
      );
    }
    if (dto.type !== StaffAttendanceType.LATE_ARRIVAL && dto.arrivalTime) {
      throw new BadRequestException(
        'arrivalTime ใช้ได้เฉพาะรายการขออนุญาตเข้าสาย',
      );
    }
    if (
      dto.type === StaffAttendanceType.LATE_ARRIVAL &&
      startDate.getTime() !== endDate.getTime()
    ) {
      throw new BadRequestException('การขออนุญาตเข้าสายต้องระบุเป็นวันเดียว');
    }

    try {
      const notice = await this.prisma.$transaction(
        async (tx) => {
          const overlapping = await tx.staffAttendanceNotice.findFirst({
            where: {
              teacherId,
              status: { not: StaffAttendanceStatus.REJECTED },
              startDate: { lte: endDate },
              endDate: { gte: startDate },
            },
            select: { id: true },
          });
          if (overlapping) {
            throw new ConflictException('มีรายการในช่วงวันที่เลือกอยู่แล้ว');
          }
          return tx.staffAttendanceNotice.create({
            data: {
              teacherId,
              type: dto.type,
              startDate,
              endDate,
              arrivalTime:
                dto.type === StaffAttendanceType.LATE_ARRIVAL
                  ? dto.arrivalTime
                  : null,
              reason,
            },
            include: {
              teacher: {
                select: {
                  id: true,
                  citizenId: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.serialize(notice);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictException('มีรายการในช่วงวันที่เลือกอยู่แล้ว');
      }
      throw error;
    }
  }

  async findMine(teacherId: string, query: StaffAttendanceHistoryQueryDto) {
    const from = query.from ? this.parseDate(query.from) : undefined;
    const to = query.to ? this.parseDate(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    }

    const notices = await this.prisma.staffAttendanceNotice.findMany({
      where: {
        teacherId,
        startDate: to ? { lte: to } : undefined,
        endDate: from ? { gte: from } : undefined,
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return notices.map((notice) => this.serialize(notice));
  }

  async getDailySummary(dateValue?: string) {
    const dateText =
      dateValue ?? dayjs().tz(this.timezone).format('YYYY-MM-DD');
    const date = this.parseDate(dateText);
    const notices = await this.prisma.staffAttendanceNotice.findMany({
      where: {
        startDate: { lte: date },
        endDate: { gte: date },
        status: StaffAttendanceStatus.APPROVED,
      },
      include: {
        teacher: {
          select: {
            id: true,
            citizenId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [
        { type: 'asc' },
        { teacher: { firstName: 'asc' } },
        { teacher: { lastName: 'asc' } },
      ],
    });

    const count = (type: StaffAttendanceType) =>
      notices.filter((notice) => notice.type === type).length;

    return {
      date: dateText,
      totals: {
        total: notices.length,
        personalLeave: count(StaffAttendanceType.PERSONAL_LEAVE),
        sickLeave: count(StaffAttendanceType.SICK_LEAVE),
        lateArrival: count(StaffAttendanceType.LATE_ARRIVAL),
      },
      records: notices.map((notice) => this.serialize(notice)),
    };
  }

  async getMyStatistics(
    teacherId: string,
    query: StaffAttendanceStatisticsQueryDto,
  ) {
    const scope = query.scope ?? 'FISCAL_YEAR';
    const period =
      scope === 'FISCAL_YEAR' ? this.fiscalPeriod(query.fiscalYear) : null;
    const notices = await this.prisma.staffAttendanceNotice.findMany({
      where: {
        teacherId,
        startDate: period ? { lte: period.endDate } : undefined,
        endDate: period ? { gte: period.startDate } : undefined,
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });

    const approved = notices.filter(
      (notice) => notice.status === StaffAttendanceStatus.APPROVED,
    );
    const typeStats = (type: StaffAttendanceType) => {
      const matching = approved.filter((notice) => notice.type === type);
      const days = matching.reduce((total, notice) => {
        if (type === StaffAttendanceType.LATE_ARRIVAL) return total;
        const clippedStart =
          period && notice.startDate < period.startDate
            ? period.startDate
            : notice.startDate;
        const clippedEnd =
          period && notice.endDate > period.endDate
            ? period.endDate
            : notice.endDate;
        return total + this.inclusiveDays(clippedStart, clippedEnd);
      }, 0);
      return { requests: matching.length, days };
    };

    const personalLeave = typeStats(StaffAttendanceType.PERSONAL_LEAVE);
    const sickLeave = typeStats(StaffAttendanceType.SICK_LEAVE);
    const lateArrival = typeStats(StaffAttendanceType.LATE_ARRIVAL);

    return {
      scope,
      period: period
        ? {
            fiscalYear: period.fiscalYear,
            fiscalYearBuddhist: period.fiscalYear + 543,
            startDate: this.dateText(period.startDate),
            endDate: this.dateText(period.endDate),
          }
        : null,
      totals: {
        requests: notices.length,
        approvedRequests: approved.length,
        pendingRequests: notices.filter(
          (notice) => notice.status === StaffAttendanceStatus.PENDING,
        ).length,
        rejectedRequests: notices.filter(
          (notice) => notice.status === StaffAttendanceStatus.REJECTED,
        ).length,
        leaveDays: personalLeave.days + sickLeave.days,
      },
      personalLeave,
      sickLeave,
      lateArrival: { requests: lateArrival.requests },
    };
  }

  async findAll(query: StaffAttendanceManagementQueryDto) {
    const from = query.from ? this.parseDate(query.from) : undefined;
    const to = query.to ? this.parseDate(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    }
    const records = await this.prisma.staffAttendanceNotice.findMany({
      where: {
        teacherId: query.teacherId,
        status: query.status,
        type: query.type,
        startDate: to ? { lte: to } : undefined,
        endDate: from ? { gte: from } : undefined,
      },
      include: {
        teacher: {
          select: {
            id: true,
            citizenId: true,
            firstName: true,
            lastName: true,
          },
        },
        reviewer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return {
      total: records.length,
      records: records.map((record) => this.serialize(record)),
    };
  }

  async review(id: string, reviewerId: string, dto: ReviewStaffAttendanceDto) {
    const existing = await this.prisma.staffAttendanceNotice.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) throw new NotFoundException('ไม่พบรายการลา');
    if (existing.status !== StaffAttendanceStatus.PENDING) {
      throw new ConflictException('รายการนี้ได้รับการพิจารณาแล้ว');
    }
    const updated = await this.prisma.staffAttendanceNotice.updateMany({
      where: { id, status: StaffAttendanceStatus.PENDING },
      data: {
        status: dto.status,
        reviewerId,
        reviewNote: dto.reviewNote?.trim() || null,
        reviewedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('รายการนี้ได้รับการพิจารณาแล้ว');
    }
    const notice = await this.prisma.staffAttendanceNotice.findUnique({
      where: { id },
      include: {
        teacher: {
          select: {
            id: true,
            citizenId: true,
            firstName: true,
            lastName: true,
          },
        },
        reviewer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    return this.serialize(notice!);
  }

  async remove(id: string) {
    const existing = await this.prisma.staffAttendanceNotice.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('ไม่พบรายการลา');
    await this.prisma.staffAttendanceNotice.delete({ where: { id } });
    return { message: 'ลบรายการลาเรียบร้อยแล้ว', id };
  }
}
