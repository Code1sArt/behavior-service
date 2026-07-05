import { Controller, Patch, Put, Get, Param, Body, UseGuards, Request, Delete } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport'; // นำเข้า Guard สำหรับเช็ค JWT
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard) // บังคับว่าต้องล็อกอิน (มี Token) ถึงจะเรียกเส้นนี้ได้
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Patch(':id')
    @ApiOperation({ summary: 'แก้ไขข้อมูลผู้ใช้งาน (Admin แก้ได้ทุกคน, User แก้ได้เฉพาะตัวเอง)' })
    update(
        @Param('id') targetId: string,      // ID ของคนที่เราต้องการจะแก้ (ส่งมาทาง URL)
        @Body() updateUserDto: UpdateUserDto, // ข้อมูลที่ต้องการแก้ (ส่งมาใน Body)
        @Request() req: any                 // ข้อมูลของคนที่กำลังล็อกอินอยู่ (NestJS ถอดมาจาก JWT)
    ) {
        // โยนข้อมูลทั้ง 3 ส่วนไปให้ Service ประมวลผล
        return this.usersService.updateUser(targetId, req.user, updateUserDto);
    }


    @UseGuards(AuthGuard('jwt'))
    @Get('me')
    @ApiOperation({ summary: 'ดึงข้อมูลโปรไฟล์ของตัวเอง (จาก Token)' })
    async getMe(@Request() req: any) {
        // req.user.userId ได้มาจาก Payload ของ JWT ตอนที่ Login สำเร็จครับ
        return this.usersService.getMe(req.user.userId);
    }

    @Put('me/password')
    @ApiOperation({ summary: 'เปลี่ยนรหัสผ่านของตัวเอง' })
    changePassword(
        @Request() req: any,
        @Body() changePasswordDto: ChangePasswordDto,
    ) {
        return this.usersService.changePassword(req.user.userId, changePasswordDto);
    }

    @Delete(':id')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'ลบผู้ใช้งาน (เฉพาะ Admin เท่านั้น)' })
    remove(@Param('id') targetId: string, @Request() req: any) {
        return this.usersService.removeUser(targetId, req.user);
    }
}
