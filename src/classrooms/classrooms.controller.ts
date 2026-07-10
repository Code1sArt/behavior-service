import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Classrooms') // หมวดหมู่ใน Swagger
@ApiBearerAuth()       // บอก Swagger ว่าหน้านี้ต้องใช้ Token
@UseGuards(AuthGuard('jwt'), RolesGuard) // ล็อกว่าต้อง Login
@Controller('classrooms')
export class ClassroomsController {
    constructor(private readonly classroomsService: ClassroomsService) { }

    @Post()
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'สร้างห้องเรียนใหม่ (เฉพาะ Admin)' })
    create(@Body() createClassroomDto: CreateClassroomDto) {
        return this.classroomsService.create(createClassroomDto);
    }

    @Get()
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'ดูรายชื่อห้องเรียนทั้งหมด' })
    findAll() {
        return this.classroomsService.findAll();
    }

    @Get(':id')
    @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS)
    @ApiOperation({ summary: 'ดูข้อมูลห้องเรียนและรายชื่อนักเรียนตาม ID' })
    // ใช้ ParseIntPipe เพื่อแปลง id จาก URL (ที่เป็น String) ให้เป็น Number
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.classroomsService.findOne(id);
    }

    @Patch(':id')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'แก้ไขข้อมูลห้องเรียน (เฉพาะ Admin)' })
    update(@Param('id', ParseIntPipe) id: number, @Body() updateClassroomDto: UpdateClassroomDto) {
        return this.classroomsService.update(id, updateClassroomDto);
    }

    @Delete(':id')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'ลบห้องเรียน (เฉพาะ Admin)' })
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.classroomsService.remove(id);
    }
}
