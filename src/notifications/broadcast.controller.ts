import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BroadcastAudienceDto, SendBroadcastDto } from './broadcast.dto';
import { BroadcastService } from './broadcast.service';

@Controller('notifications/broadcasts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
export class BroadcastController {
  constructor(private readonly service: BroadcastService) {}

  @Get('options')
  options() {
    return this.service.options();
  }

  @Post('preview')
  preview(@Body() dto: BroadcastAudienceDto) {
    return this.service.preview(dto);
  }

  @Post()
  send(
    @Req() req: { user: { userId: string } },
    @Body() dto: SendBroadcastDto,
  ) {
    return this.service.send(req.user.userId, dto);
  }
}
