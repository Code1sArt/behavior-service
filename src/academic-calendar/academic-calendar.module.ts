import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AcademicCalendarService } from './academic-calendar.service';

@Module({
  imports: [PrismaModule],
  providers: [AcademicCalendarService],
  exports: [AcademicCalendarService],
})
export class AcademicCalendarModule {}
