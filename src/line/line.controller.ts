import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SendTestNotificationDto } from './dto/send-test-notification.dto';
import { LineService } from './line.service';

@ApiTags('LINE Notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
@Controller('line')
export class LineController {
  constructor(private readonly lineService: LineService) {}

  @Get('linked-users')
  @ApiOperation({ summary: 'ดึงรายชื่อผู้ใช้ที่ผูกบัญชี LINE (เฉพาะ Admin)' })
  findLinkedUsers() {
    return this.lineService.findLinkedUsers();
  }

  @Post('test-notification')
  @ApiOperation({ summary: 'ส่งข้อความทดสอบไปยังผู้ใช้ที่เลือก (เฉพาะ Admin)' })
  sendTestNotification(@Body() dto: SendTestNotificationDto) {
    return this.lineService.sendTestNotification(dto.userId, dto.message);
  }
}
