import { Controller, Get, Param, UseGuards, ParseIntPipe } from '@nestjs/common';
import { SummaryService } from './summary.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Summary & Dashboard')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('summary')
export class SummaryController {
    constructor(private readonly summaryService: SummaryService) { }

    @Get('student/:id')
    @Roles(Role.ADMIN, Role.TEACHER, Role.PARENT, Role.STUDENT, Role.AFFAIRS)
    @ApiOperation({ summary: 'ดูสรุปคะแนนรายบุคคล (อ้างอิงตามเกณฑ์ของห้องเรียน)' })
    getStudent(@Param('id') id: string) {
        return this.summaryService.getStudentSummary(id);
    }

    @Get('classroom/:classroomId')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'สรุปภาพรวมรายห้อง (ใช้เกณฑ์ที่ตั้งค่าไว้ใน Classroom)' })
    getClassroom(@Param('classroomId', ParseIntPipe) classroomId: number) {
        return this.summaryService.getClassroomSummary(classroomId);
    }


    @Get('school-wide')
    @Roles(Role.ADMIN, Role.AFFAIRS) // ให้สิทธิ์เฉพาะผู้ดูแลระบบและฝ่ายกิจการ
    @ApiOperation({ summary: 'สรุปผลคะแนนทั้งโรงเรียน (แยกกลุ่มผ่าน, ตก, เกียรติบัตร, โล่)' })
    getSchoolWide() {
        return this.summaryService.getSchoolWideSummary();
    }
}