import { AttendanceArchiveService } from './attendance-archive.service';
import { AttendanceArchiveController } from './attendance-archive.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LineModule } from 'src/line/line.module';
import { AcademicCalendarModule } from '../academic-calendar/academic-calendar.module';

@Module({
  providers: [AttendanceService, AttendanceArchiveService],
  controllers: [AttendanceController, AttendanceArchiveController],
  imports: [
    NotificationsModule,
    PrismaModule,
    LineModule,
    AcademicCalendarModule,
  ],
})
export class AttendanceModule {}
