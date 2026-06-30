import { Controller, Post, Body, Get, Param, Delete, UseGuards, Request, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { BehaviorsService } from './behaviors.service';
import { CreateBehaviorDto, CreateBulkBehaviorDto } from './dto/create-behavior.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('Behavior Records (คะแนนพฤติกรรม)')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('behaviors')
export class BehaviorsController {
    constructor(private readonly behaviorsService: BehaviorsService) { }

    @Post()
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'บันทึกคะแนนความดี/พฤติกรรม (ตรวจสอบสิทธิ์จากหมวดหมู่)' })
    create(@Request() req: any, @Body() createBehaviorDto: CreateBehaviorDto) {
        // ส่งทั้ง ID และ Role ไปให้ Service ช่วยเช็คสิทธิ์
        return this.behaviorsService.create(req.user.userId, req.user.role, createBehaviorDto);
    }

    @Get('student/:studentId')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.PARENT, Role.STUDENT)
    @ApiOperation({ summary: 'ดูประวัติคะแนนพฤติกรรมของนักเรียน' })
    findByStudent(@Param('studentId') studentId: string) {
        return this.behaviorsService.findByStudent(studentId);
    }

    @Delete(':id')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'ลบประวัติการบันทึก (ลบได้เฉพาะคนบันทึก หรือ Admin)' })
    remove(@Param('id') id: string, @Request() req: any) {
        return this.behaviorsService.remove(id, req.user.userId, req.user.role);
    }

    @Post('bulk')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'บันทึกคะแนนพฤติกรรมพร้อมกันหลายคน (แบบกลุ่ม)' })
    createBulk(@Request() req: any, @Body() createBulkBehaviorDto: CreateBulkBehaviorDto) {
        return this.behaviorsService.createBulk(req.user.userId, req.user.role, createBulkBehaviorDto);
    }


    @Get('history')
    @ApiOperation({ summary: 'ดึงประวัติการบันทึกพฤติกรรมทั้งหมด (กรองตามวัน, ห้อง, นักเรียนได้)' })
    @ApiQuery({ name: 'date', required: false, description: 'รูปแบบ YYYY-MM-DD' })
    @ApiQuery({ name: 'classroomId', required: false, description: 'ID ของห้องเรียน' })
    @ApiQuery({ name: 'studentId', required: false, description: 'UUID ของนักเรียน' })
    getBehaviorHistory(
        @Query('date') date?: string,
        @Query('classroomId') classroomId?: number,
        @Query('studentId') studentId?: string,
        @Query('termId') termId?: number,
    ) {
        return this.behaviorsService.getBehaviorHistory(date, classroomId, studentId, termId);
    }


    @Post('import-excel')
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ summary: 'นำเข้าคะแนนพฤติกรรมผ่าน Excel' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                    description: 'ไฟล์ Excel ที่มีคอลัมน์ citizenId, points, note, categoryId',
                },
            },
            required: ['file'],
        },
    })
    @UseInterceptors(FileInterceptor('file'))
    async importExcel(
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any
    ) {
        // ตรวจสอบว่ามีไฟล์และมีข้อมูล User จาก Token
        return await this.behaviorsService.importFromExcel(file, req.user.userId);
    }
}
