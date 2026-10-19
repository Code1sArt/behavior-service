import { StudentAccessService } from '../prisma/student-access.service';
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Patch,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import {
  CreateBulkAttendanceDto,
  ManualAttendanceDto,
  UpdateAttendanceDto,
} from './dto/create-attendance.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AttendanceType, Role } from '@prisma/client';

@ApiTags('Attendance (เช็คชื่อ)')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly access: StudentAccessService,
  ) {}

  @Post('bulk')
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
  @ApiOperation({
    summary: 'บันทึกการเช็คชื่อแบบกลุ่ม (ดึงคะแนนอัตโนมัติจาก PointCategory)',
  })
  async recordBulk(@Request() req: any, @Body() dto: CreateBulkAttendanceDto) {
    await Promise.all(
      dto.records.map((record) =>
        this.access.student(req.user, record.studentId),
      ),
    );
    return this.attendanceService.recordBulk(req.user.userId, dto);
  }

  @Post('manual')
  @Roles(Role.ADMIN, Role.AFFAIRS)
  @ApiOperation({
    summary: 'เพิ่มหรือแก้ไขสถานะการเช็คชื่อตามวันที่สำหรับผู้ดูแลระบบ',
  })
  upsertManualAttendance(
    @Request() req: any,
    @Body() dto: ManualAttendanceDto,
  ) {
    return this.attendanceService.upsertManualAttendance(req.user.userId, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
  @ApiOperation({
    summary: 'แก้ไขสถานะการเช็คชื่อ (ลบ/หักคะแนนชดเชยอัตโนมัติ)',
  })
  updateAttendance(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: UpdateAttendanceDto,
  ) {
    return this.attendanceService.updateAttendance(id, req.user.userId, dto);
  }

  @Get('student/:studentId')
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.PARENT, Role.STUDENT)
  @ApiOperation({ summary: 'ดูประวัติการเช็คชื่อของนักเรียน' })
  getStudentAttendance(
    @Param('studentId') studentId: string,
    @Request() req: any,
  ) {
    return this.attendanceService.getStudentAttendance(
      studentId,
      req.user.userId,
      req.user.role,
    );
  }

  @Get('missing-report')
  @Roles(Role.ADMIN, Role.AFFAIRS) // ล็อคให้เฉพาะฝ่ายกิจการและแอดมินดูได้
  @ApiOperation({
    summary: 'ดูรายงานห้องที่ยังไม่ได้เช็คชื่อ (เข้าแถว/เขตพื้นที่) ประจำวัน',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-04-26',
    description: 'วันที่ต้องการดู (YYYY-MM-DD) ถ้าไม่ระบุจะดึงข้อมูลของวันนี้',
  })
  getMissingReport(@Query('date') date?: string) {
    return this.attendanceService.getMissingAttendanceClassrooms(date);
  }

  @Get('history/daily')
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
  @ApiOperation({
    summary: 'ดึงประวัติการเช็คชื่อรายวัน แยกประเภท (เข้าแถว/เขตพื้นที่)',
  })
  @ApiQuery({ name: 'date', required: false, description: 'รูปแบบ YYYY-MM-DD' })
  @ApiQuery({
    name: 'classroomId',
    required: false,
    description: 'ID ห้องเรียน',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: AttendanceType,
    description: 'ASSEMBLY หรือ AREA',
  })
  async getDailyHistory(
    @Request() req: any,
    @Query('date') date?: string,
    @Query('classroomId') classroomId?: number,
    @Query('type') type?: AttendanceType,
  ) {
    await this.access.classroom(
      req.user,
      classroomId === undefined ? undefined : Number(classroomId),
    );
    return this.attendanceService.getDailyHistory(date, classroomId, type);
  }

  @Get('summary/daily')
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
  @ApiOperation({
    summary: 'สรุปสถิติการเช็คชื่อรายวัน แยกรายห้อง พร้อมคิดร้อยละ',
  })
  @ApiQuery({ name: 'date', required: false, description: 'รูปแบบ YYYY-MM-DD' })
  @ApiQuery({
    name: 'classroomId',
    required: false,
    description: 'ID ห้องเรียน',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: AttendanceType,
    description: 'ASSEMBLY หรือ AREA (ค่าเริ่มต้นคือ ASSEMBLY)',
  })
  async getDailySummary(
    @Request() req: any,
    @Query('date') date?: string,
    @Query('classroomId') classroomId?: number,
    @Query('type') type?: AttendanceType,
  ) {
    await this.access.classroom(
      req.user,
      classroomId === undefined ? undefined : Number(classroomId),
    );
    return this.attendanceService.getDailySummary(date, classroomId, type);
  }

  @Post('notify-missing')
  @Roles(Role.ADMIN, Role.AFFAIRS)
  @ApiOperation({
    summary: 'ส่งข้อความแจ้งเตือนครูที่ปรึกษาที่ยังไม่ได้เช็คชื่อผ่าน LINE',
  })
  async notifyMissing(@Body('date') date?: string) {
    // ส่งวันที่ไปให้ Service เพื่อประมวลผลการส่ง LINE
    return await this.attendanceService.sendLineNotification(date);
  }
}
