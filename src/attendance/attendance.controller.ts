import { Controller, Post, Body, Get, Param, Patch, UseGuards, Request, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { CreateBulkAttendanceDto, UpdateAttendanceDto } from './dto/create-attendance.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AttendanceType, Role } from '@prisma/client';

@ApiTags('Attendance (เช็คชื่อ)')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('attendance')
export class AttendanceController {
    constructor(private readonly attendanceService: AttendanceService) { }

    @Post('bulk')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'บันทึกการเช็คชื่อแบบกลุ่ม (ดึงคะแนนอัตโนมัติจาก PointCategory)' })
    recordBulk(@Request() req: any, @Body() dto: CreateBulkAttendanceDto) {
        return this.attendanceService.recordBulk(req.user.userId, dto);
    }

    @Patch(':id')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'แก้ไขสถานะการเช็คชื่อ (ลบ/หักคะแนนชดเชยอัตโนมัติ)' })
    updateAttendance(@Param('id') id: string, @Request() req: any, @Body() dto: UpdateAttendanceDto) {
        return this.attendanceService.updateAttendance(id, req.user.userId, dto);
    }

    @Get('student/:studentId')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.PARENT, Role.STUDENT)
    @ApiOperation({ summary: 'ดูประวัติการเช็คชื่อของนักเรียน' })
    getStudentAttendance(@Param('studentId') studentId: string) {
        return this.attendanceService.getStudentAttendance(studentId);
    }

    @Get('missing-report')
    @Roles(Role.ADMIN, Role.AFFAIRS) // ล็อคให้เฉพาะฝ่ายกิจการและแอดมินดูได้
    @ApiOperation({ summary: 'ดูรายงานห้องที่ยังไม่ได้เช็คชื่อ (เข้าแถว/เขตพื้นที่) ประจำวัน' })
    @ApiQuery({
        name: 'date',
        required: false,
        example: '2026-04-26',
        description: 'วันที่ต้องการดู (YYYY-MM-DD) ถ้าไม่ระบุจะดึงข้อมูลของวันนี้'
    })
    getMissingReport(@Query('date') date?: string) {
        return this.attendanceService.getMissingAttendanceClassrooms(date);
    }


    @Get('history/daily')
    @ApiOperation({ summary: 'ดึงประวัติการเช็คชื่อรายวัน แยกประเภท (เข้าแถว/เขตพื้นที่)' })
    @ApiQuery({ name: 'date', required: false, description: 'รูปแบบ YYYY-MM-DD' })
    @ApiQuery({ name: 'classroomId', required: false, description: 'ID ห้องเรียน' })
    @ApiQuery({ name: 'type', required: false, enum: AttendanceType, description: 'ASSEMBLY หรือ AREA' })
    getDailyHistory(
        @Query('date') date?: string,
        @Query('classroomId') classroomId?: number,
        @Query('type') type?: AttendanceType,
    ) {
        return this.attendanceService.getDailyHistory(date, classroomId, type);
    }

    @Get('summary/daily')
    @ApiOperation({ summary: 'สรุปสถิติการเช็คชื่อรายวัน แยกรายห้อง พร้อมคิดร้อยละ' })
    @ApiQuery({ name: 'date', required: false, description: 'รูปแบบ YYYY-MM-DD' })
    @ApiQuery({ name: 'classroomId', required: false, description: 'ID ห้องเรียน' })
    @ApiQuery({ name: 'type', required: false, enum: AttendanceType, description: 'ASSEMBLY หรือ AREA (ค่าเริ่มต้นคือ ASSEMBLY)' })
    getDailySummary(
        @Query('date') date?: string,
        @Query('classroomId') classroomId?: number,
        @Query('type') type?: AttendanceType,
    ) {
        return this.attendanceService.getDailySummary(date, classroomId, type);
    }

    @Post('notify-missing')
    @ApiOperation({ summary: 'ส่งข้อความแจ้งเตือนครูที่ปรึกษาที่ยังไม่ได้เช็คชื่อผ่าน LINE' })
    async notifyMissing(@Body('date') date?: string) {
        // ส่งวันที่ไปให้ Service เพื่อประมวลผลการส่ง LINE
        return await this.attendanceService.sendLineNotification(date);
    }
}