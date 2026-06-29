import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private async findTerm(termId: number) {
    const term = await this.prisma.academicTerm.findUnique({
      where: { id: termId },
      select: {
        id: true,
        startDate: true,
        endDate: true,
      }, 
    });

    if (!term) {
      throw new NotFoundException(`ไม่พบข้อมูลภาคเรียน ID: ${termId}`);
    }

    return term;
  }

  private async validateHolidayDate(
    termId: number,
    date: Date,
    excludedHolidayId?: number,
  ) {
    const [term, duplicate] = await Promise.all([
      this.findTerm(termId),
      this.prisma.academicHoliday.findFirst({
        where: {
          academicTermId: termId,
          date,
          ...(excludedHolidayId !== undefined && {
            id: { not: excludedHolidayId },
          }),
        },
        select: { id: true },
      }),
    ]);

    if (date < term.startDate || date > term.endDate) {
      throw new BadRequestException(
        'วันหยุดต้องอยู่ภายในช่วงวันที่ของภาคเรียน',
      );
    }

    if (duplicate) {
      throw new ConflictException('มีวันหยุดในวันที่นี้อยู่แล้วในภาคเรียน');
    }
  }

  // ตรวจสอบว่ามีวันหยุดในภาคเรียนนี้หรือไม่
  private async findHoliday(termId: number, holidayId: number) {
    const holiday = await this.prisma.academicHoliday.findFirst({
      where: {
        id: holidayId,
        academicTermId: termId,
      },
    });

    if (!holiday) {
      throw new NotFoundException(
        `ไม่พบข้อมูลวันหยุด ID: ${holidayId} ในภาคเรียน ID: ${termId}`,
      );
    }

    return holiday;
  }

  private handleDuplicateDate(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('มีวันหยุดในวันที่นี้อยู่แล้วในภาคเรียน');
    }

    throw error;
  }
  // สร้างวันหยุดใหม่ในภาคเรียน โดยตรวจสอบช่วงวันที่และวันที่ซ้ำ
  async create(termId: number, dto: CreateHolidayDto) {
    const date = new Date(dto.date);
    await this.validateHolidayDate(termId, date);

    try {
      return await this.prisma.academicHoliday.create({
        data: {
          date,
          name: dto.name,
          academicTermId: termId,
        },
      });
    } catch (error) {
      this.handleDuplicateDate(error);
    }
  }

  async findAll(termId: number) {
    await this.findTerm(termId);

    return this.prisma.academicHoliday.findMany({
      where: { academicTermId: termId },
      orderBy: { date: 'asc' },
    });
  }

  async getCalendar(termId: number, month: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    const year = match ? Number(match[1]) : 0;
    const monthNumber = match ? Number(match[2]) : 0;

    if (!match || monthNumber < 1 || monthNumber > 12) {
      throw new BadRequestException('เดือนต้องอยู่ในรูปแบบ YYYY-MM');
    }

    const term = await this.findTerm(termId);
    const monthStart = new Date(Date.UTC(year, monthNumber - 1, 1));
    const monthEnd = new Date(Date.UTC(year, monthNumber, 0));
    const holidays = await this.prisma.academicHoliday.findMany({
      where: {
        academicTermId: termId,
        date: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
      select: {
        date: true,
        name: true,
      },
    });
    const holidayNames = new Map(
      holidays.map((holiday) => [this.formatDate(holiday.date), holiday.name]),
    );

    let workingDays = 0;
    const days: {
      date: string;
      isSchoolDay: boolean;
      reason: string | null;
    }[] = [];

    for (
      let date = new Date(monthStart);
      date <= monthEnd;
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      const currentDate = new Date(date);
      const dateString = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();
      const isOutsideTerm =
        currentDate < term.startDate || currentDate > term.endDate;
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const holidayName = holidayNames.get(dateString);

      let reason: string | null = null;
      if (isOutsideTerm) {
        reason = 'OUTSIDE_TERM';
      } else if (isWeekend) {
        reason = 'WEEKEND';
      } else if (holidayName) {
        reason = holidayName;
      }

      const isSchoolDay = reason === null;
      if (isSchoolDay) {
        workingDays++;
      }

      days.push({
        date: dateString,
        isSchoolDay,
        reason,
      });
    }

    return {
      termId,
      workingDays,
      days,
    };
  }

  async update(termId: number, holidayId: number, dto: UpdateHolidayDto) {
    const holiday = await this.findHoliday(termId, holidayId);
    const date = dto.date !== undefined ? new Date(dto.date) : holiday.date;

    await this.validateHolidayDate(termId, date, holidayId);

    try {
      return await this.prisma.academicHoliday.update({
        where: { id: holidayId },
        data: {
          ...(dto.date !== undefined && { date }),
          ...(dto.name !== undefined && { name: dto.name }),
        },
      });
    } catch (error) {
      this.handleDuplicateDate(error);
    }
  }

  async remove(termId: number, holidayId: number) {
    await this.findHoliday(termId, holidayId);

    return this.prisma.academicHoliday.delete({
      where: { id: holidayId },
    });
  }
}
