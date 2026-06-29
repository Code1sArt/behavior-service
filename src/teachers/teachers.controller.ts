import { BadRequestException, Body, Controller, Get, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { TeachersService } from './teachers.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';

@ApiTags('Teachers Management')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('teachers')
export class TeachersController {
    constructor(private readonly teachersService: TeachersService) { }

    // 1. API เพิ่มบุคลากรรายบุคคล
    @Post('staff')
    @Roles(Role.ADMIN) // บังคับให้เป็น ADMIN เท่านั้น
    @ApiOperation({ summary: 'เพิ่มบุคลากรใหม่ (ทีละ 1 คน)' })
    createStaff(@Body() createStaffDto: CreateStaffDto) {
        return this.teachersService.createStaff(createStaffDto);
    }

    // 2. API อัปโหลดไฟล์ Excel
    @Post('staff/upload-excel')
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'เพิ่มบุคลากรจำนวนมากผ่าน Excel' })
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
    @ApiConsumes('multipart/form-data') // แจ้ง Swagger ว่ารับไฟล์
    @UseInterceptors(FileInterceptor('file')) // รับไฟล์จาก field ชื่อ 'file'
    uploadStaffExcel(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('กรุณาอัปโหลดไฟล์ Excel');
        }

        // ตรวจสอบนามสกุลไฟล์เบื้องต้น
        if (!file.originalname.match(/\.(xlsx|xls|csv)$/)) {
            throw new BadRequestException('รองรับเฉพาะไฟล์ .xlsx, .xls หรือ .csv เท่านั้น');
        }

        return this.teachersService.createStaffFromExcel(file);
    }


    // เปิด API ดึงข้อมูลบุคลากร
    @Get('staff')
    @Roles(Role.ADMIN, Role.AFFAIRS) // อนุญาตให้แอดมินและฝ่ายกิจการดูได้
    @ApiOperation({ summary: 'ดึงรายชื่อบุคลากรทั้งหมด (ครู, กิจการ)' })
    findAllStaff() {
        return this.teachersService.findAllStaff();
    }

}
