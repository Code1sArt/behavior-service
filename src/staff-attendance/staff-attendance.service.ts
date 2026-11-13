import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma, StaffAttendanceType } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStaffAttendanceDto,
  StaffAttendanceHistoryQueryDto,
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

  private serialize<T extends { date: Date }>(notice: T) {
    return { ...notice, date: notice.date.toISOString().slice(0, 10) };
  }

  async create(teacherId: string, dto: CreateStaffAttendanceDto) {
    const date = this.parseDate(dto.date);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('กรุณาระบุเหตุผล');

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

    const duplicate = await this.prisma.staffAttendanceNotice.findUnique({
      where: { teacherId_date: { teacherId, date } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('คุณแจ้งสถานะสำหรับวันนี้ไว้แล้ว');
    }

    try {
      const notice = await this.prisma.staffAttendanceNotice.create({
        data: {
          teacherId,
          type: dto.type,
          date,
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
      return this.serialize(notice);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('คุณแจ้งสถานะสำหรับวันนี้ไว้แล้ว');
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
        date: from || to ? { gte: from, lte: to } : undefined,
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return notices.map((notice) => this.serialize(notice));
  }

  async getDailySummary(dateValue?: string) {
    const dateText =
      dateValue ?? dayjs().tz(this.timezone).format('YYYY-MM-DD');
    const date = this.parseDate(dateText);
    const notices = await this.prisma.staffAttendanceNotice.findMany({
      where: { date },
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
}
