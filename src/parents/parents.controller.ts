import { Controller, Post, Body, Patch, UseGuards, Request, Get, Delete, Param } from '@nestjs/common';
import { ParentsService } from './parents.service';
import { CreateParentDto } from './dto/create-parent.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { AddChildDto } from './dto/add-child.dto';

@ApiTags('Parents Management')
@Controller('parents')
export class ParentsController {
    constructor(private readonly parentsService: ParentsService) { }

    // API นี้เป็น Public (ไม่ใส่ @UseGuards) เพื่อให้สมัครจาก LINE Mini App ได้เลย
    @Post('register')
    @ApiOperation({ summary: 'ลงทะเบียนผู้ปกครองใหม่ (รองรับ LINE Mini App)' })
    @ApiResponse({ status: 201, description: 'ลงทะเบียนและเชื่อมโยงบุตรหลานสำเร็จ' })
    @ApiResponse({ status: 404, description: 'ไม่พบรหัสนักเรียน' })
    @ApiResponse({ status: 409, description: 'รหัสประชาชนผู้ปกครอง หรือ LINE ID ถูกใช้งานแล้ว' })
    register(@Body() createParentDto: CreateParentDto) {
        return this.parentsService.register(createParentDto);
    }


    @Patch('add-child')
    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles(Role.PARENT, Role.ADMIN) // เฉพาะผู้ปกครองเท่านั้นที่กดเพิ่มลูกเองได้
    @ApiOperation({ summary: 'เพิ่มบุตรหลานในปกครอง (สำหรับผู้ปกครองที่ Login แล้ว)' })
    addChild(@Request() req: any, @Body() dto: AddChildDto) {
        // ดึง ID ของผู้ปกครองมาจาก Token (req.user.userId)
        const targetParentId = dto.parentId ? dto.parentId : req.user.id;
        console.log("shh",targetParentId);
        
        return this.parentsService.addChild(targetParentId, dto);
    }

    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @Get('all')
    @ApiOperation({ summary: 'ดึงรายชื่อผู้ปกครองทั้งหมดพร้อมนักเรียนในความดูแล (Admin/Staff)' })
    async getAllParents() {
        return await this.parentsService.findAll();
    }


    @ApiBearerAuth()
    @UseGuards(AuthGuard('jwt'))
    @Delete(':id')
    @ApiOperation({ summary: 'ลบข้อมูลผู้ปกครอง (Admin เท่านั้น หรือตามนโยบาย)' })
    async removeParent(@Param('id') id: string) {
        return await this.parentsService.removeParent(id);
    }
}