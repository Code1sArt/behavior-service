import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateStaffAttendanceDto,
  DailyStaffAttendanceQueryDto,
  StaffAttendanceHistoryQueryDto,
} from './dto/create-staff-attendance.dto';
import { StaffAttendanceService } from './staff-attendance.service';

type AuthRequest = { user: { userId: string; role: Role } };

@ApiTags('Staff Attendance (การลาและเข้าสายของครู)')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('staff-attendance')
export class StaffAttendanceController {
  constructor(private readonly service: StaffAttendanceService) {}

  @Post()
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'ครูแจ้งลากิจ ลาป่วย หรือขออนุญาตเข้าสาย' })
  create(@Request() req: AuthRequest, @Body() dto: CreateStaffAttendanceDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Get('mine')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'ดูประวัติการแจ้งของครูที่เข้าสู่ระบบ' })
  findMine(
    @Request() req: AuthRequest,
    @Query() query: StaffAttendanceHistoryQueryDto,
  ) {
    return this.service.findMine(req.user.userId, query);
  }

  @Get('summary/daily')
  @Roles(Role.ADMIN, Role.EXECUTIVE)
  @ApiOperation({ summary: 'สรุปลากิจ ลาป่วย และเข้าสายของครูรายวัน' })
  getDailySummary(@Query() query: DailyStaffAttendanceQueryDto) {
    return this.service.getDailySummary(query.date);
  }
}
