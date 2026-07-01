import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthService } from './auth/auth.service';
import { AuthModule } from './auth/auth.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { PointCategoriesModule } from './point-categories/point-categories.module';
import { StudentsModule } from './students/students.module';
import { ParentsModule } from './parents/parents.module';
import { TermsModule } from './terms/terms.module';
import { AttendanceModule } from './attendance/attendance.module';
import { BehaviorsModule } from './behaviors/behaviors.module';
import { SummaryModule } from './summary/summary.module';
import { LineModule } from './line/line.module';
import { UsersService } from './users/users.service';
import { UsersController } from './users/users.controller';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { TeachersModule } from './teachers/teachers.module';
import { HolidaysModule } from './holidays/holidays.module';
import { AcademicCalendarModule } from './academic-calendar/academic-calendar.module';
import { PromotionsModule } from './promotions/promotions.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ClassroomsModule,
    PointCategoriesModule,
    StudentsModule,
    ParentsModule,
    TermsModule,
    AttendanceModule,
    BehaviorsModule,
    SummaryModule,
    LineModule,
    UsersModule,
    SettingsModule,
    TeachersModule,
    HolidaysModule,
    AcademicCalendarModule,
    PromotionsModule,
  ],
  controllers: [AppController, UsersController],
  providers: [AppService, UsersService],
})
export class AppModule {}
