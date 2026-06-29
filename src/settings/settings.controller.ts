import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateAttendanceTimeDto } from './dto/update-config.dto';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard'; // สมมติว่ามี Guard สิทธิ์
import { Roles } from '../auth/decorators/roles.decorator'; // สมมติว่ามี Decorator สำหรับกำหนดสิทธิ์
import { Role } from '@prisma/client';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('settings')
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Get('attendance-time')
    @ApiOperation({ summary: 'ดูเวลาตัดยอดเช็คชื่อปัจจุบัน' })
    getCutoffTime() {
        return this.settingsService.getAttendanceCutoffTime();
    }

    // สงวนสิทธิ์ให้เฉพาะ ADMIN เท่านั้นที่แก้เวลานี้ได้
    @Patch('attendance-time')
    @UseGuards(RolesGuard)
    @Roles(Role.ADMIN)
    @ApiOperation({ summary: 'แก้ไขเวลาตัดยอดเช็คชื่อ (รับค่า HH:mm)' })
    updateCutoffTime(@Body() updateDto: UpdateAttendanceTimeDto) {
        return this.settingsService.updateAttendanceCutoffTime(updateDto);
    }
}