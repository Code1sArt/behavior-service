import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, UseInterceptors, UploadedFile, ParseFilePipe, FileTypeValidator, MaxFileSizeValidator } from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';

@ApiTags('Students Management')
@ApiBearerAuth()
// @UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('students')
export class StudentsController { 
    constructor(private readonly studentsService: StudentsService) { }

    @Post()
    @Roles(Role.ADMIN, Role.TEACHER) // Admin และ Teacher เพิ่มได้
    @ApiOperation({ summary: 'เพิ่มนักเรียนใหม่ (Admin, Teacher)' })
    create(@Body() createStudentDto: CreateStudentDto) {
        return this.studentsService.create(createStudentDto);
    }

    @Get()
    // @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'ดูรายชื่อนักเรียนทั้งหมด' })
    findAll(@Query('classroomId') classroomId?: string) {
        return this.studentsService.findAll(classroomId ? +classroomId : undefined);
    }

    @Patch(':id')
    @Roles(Role.ADMIN, Role.TEACHER) // Admin และ Teacher แก้ไขได้
    @ApiOperation({ summary: 'แก้ไขข้อมูลนักเรียน (Admin, Teacher)' })
    update(@Param('id') id: string, @Body() updateStudentDto: UpdateStudentDto) {
        return this.studentsService.update(id, updateStudentDto);
    }

    @Delete(':id')
    @Roles(Role.ADMIN) // <--- เฉพาะ ADMIN เท่านั้นที่ลบได้ตามโจทย์ครับ
    @ApiOperation({ summary: 'ลบข้อมูลนักเรียน (เฉพาะ Admin เท่านั้น)' })
    remove(@Param('id') id: string) {
        return this.studentsService.remove(id);
    }

    @Post('upload')
    @Roles(Role.ADMIN, Role.TEACHER) // อนุญาตทั้ง Admin และ ครู
    @UseInterceptors(FileInterceptor('file'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @ApiOperation({ summary: 'นำเข้านักเรียนผ่านไฟล์ Excel (.xlsx, .csv)' })
    async uploadFile(
        @UploadedFile(
            new ParseFilePipe({
                validators: [
                    new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 5 }), // จำกัด 5MB
                    new FileTypeValidator({ fileType: /(csv|excel|spreadsheetml)/ }),
                ],
            }),
        ) file: Express.Multer.File,
    ) {
        return this.studentsService.importStudents(file);
    }
}