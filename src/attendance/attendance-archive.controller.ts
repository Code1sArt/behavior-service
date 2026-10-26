import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AttendanceArchiveService } from './attendance-archive.service';

export class PurgeAttendanceArchiveDto {
  @IsString()
  @MinLength(20)
  @MaxLength(20000)
  receipt!: string;
}

@ApiTags('Attendance archive')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
@Controller('attendance/archive')
export class AttendanceArchiveController {
  constructor(private readonly archives: AttendanceArchiveService) {}

  @Get('export')
  @Header('Content-Type', 'application/sql; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="dsps-attendance.sql"')
  @Header('Cache-Control', 'no-store')
  exportSql(@Query('termId') termId?: string) {
    return this.archives.exportSql(
      termId === undefined ? undefined : Number(termId),
    );
  }

  @Post('purge')
  purge(
    @Body() dto: PurgeAttendanceArchiveDto,
    @Request() req: { user: { userId: string } },
  ) {
    return this.archives.purge(dto.receipt, req.user.userId);
  }
}
