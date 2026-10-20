import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsDateString, IsNotEmpty, IsString } from 'class-validator';
import { NotificationInboxService } from './notification-inbox.service';

class ReadAllDto {
  @IsDateString() until!: string;
}
class ReadEventDto {
  @IsString() @IsNotEmpty() eventId!: string;
}

@Controller('notifications/inbox')
@UseGuards(AuthGuard('jwt'))
export class NotificationInboxController {
  constructor(private readonly service: NotificationInboxService) {}

  @Get()
  list(@Request() req: any, @Query('cursor') cursor?: string) {
    return this.service.list(req.user.userId, cursor);
  }

  @Patch('read-all')
  readAll(@Request() req: any, @Body() dto: ReadAllDto) {
    return this.service.readAll(req.user.userId, dto.until);
  }

  @Get('unread-count')
  unread(@Request() req: any) {
    return this.service.unread(req.user.userId);
  }

  @Patch('read-event')
  readEvent(@Request() req: any, @Body() dto: ReadEventDto) {
    return this.service.readEvent(req.user.userId, dto.eventId);
  }

  @Patch(':id/read')
  read(@Request() req: any, @Param('id') id: string) {
    return this.service.read(req.user.userId, id);
  }
}
