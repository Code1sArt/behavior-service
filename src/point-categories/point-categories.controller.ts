import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseIntPipe } from '@nestjs/common';
import { PointCategoriesService } from './point-categories.service';
import { CreatePointCategoryDto } from './dto/create-point-category.dto';
import { UpdatePointCategoryDto } from './dto/update-point-category.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Point Categories')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('point-categories')
export class PointCategoriesController {
    constructor(private readonly pointCategoriesService: PointCategoriesService) { }

    @Post()
    @Roles(Role.ADMIN) // ให้ Admin สร้างได้เท่านั้น
    @ApiOperation({ summary: 'สร้างประเภทคะแนนใหม่ (เฉพาะ Admin)' })
    create(@Body() createPointCategoryDto: CreatePointCategoryDto) {
        return this.pointCategoriesService.create(createPointCategoryDto);
    }

    @Get()
    @Roles(Role.ADMIN, Role.AFFAIRS, Role.TEACHER) // ให้ครูและฝ่ายกิจการดูรายการไปดรอปดาวน์ได้
    @ApiOperation({ summary: 'ดูประเภทคะแนนทั้งหมด (Admin, Affairs, Teacher)' })
    findAll() {
        return this.pointCategoriesService.findAll();
    }

    @Get(':id')
    @Roles(Role.ADMIN, Role.AFFAIRS, Role.TEACHER)
    @ApiOperation({ summary: 'ดูประเภทคะแนนตาม ID' })
    findOne(@Param('id', ParseIntPipe) id: number) {
        return this.pointCategoriesService.findOne(id);
    }

    @Patch(':id')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'แก้ไขประเภทคะแนน (เฉพาะ Admin)' })
    update(@Param('id', ParseIntPipe) id: number, @Body() updatePointCategoryDto: UpdatePointCategoryDto) {
        return this.pointCategoriesService.update(id, updatePointCategoryDto);
    }

    @Delete(':id')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'ลบประเภทคะแนน (เฉพาะ Admin)' })
    remove(@Param('id', ParseIntPipe) id: number) {
        return this.pointCategoriesService.remove(id);
    }
}
