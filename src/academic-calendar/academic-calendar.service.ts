import { Injectable, NotFoundException } from '@nestjs/common';
import dayjs, { Dayjs } from 'dayjs';
import { PrismaService } from '../prisma/prisma.service';

export type SchoolDayStatus =
  | { isSchoolDay: true; reason: null }
  | { isSchoolDay: false; reason: string };

@Injectable()
export class AcademicCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async getSchoolDayStatus(
    termId: number,
    date: Dayjs,
  ): Promise<SchoolDayStatus> {
    const term = await this.prisma.academicTerm.findUnique({
      where: { id: termId },
      include: { holidays: true },
    });

    if (!term) {
      throw new NotFoundException('ไม่พบภาคเรียน');
    }

    if (
      date.isBefore(dayjs(term.startDate), 'day') ||
      date.isAfter(dayjs(term.endDate), 'day')
    ) {
      return { isSchoolDay: false, reason: 'OUTSIDE_TERM' };
    }

    if (date.day() === 0 || date.day() === 6) {
      return { isSchoolDay: false, reason: 'WEEKEND' };
    }

    const dateString = date.format('YYYY-MM-DD');
    const holiday = term.holidays.find(
      (item) => dayjs(item.date).format('YYYY-MM-DD') === dateString,
    );

    if (holiday) {
      return { isSchoolDay: false, reason: holiday.name };
    }

    return { isSchoolDay: true, reason: null };
  }
}
