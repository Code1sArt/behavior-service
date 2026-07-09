import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Academic Holidays')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
@Controller('terms/:termId/holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Post()
  @ApiOperation({ summary: 'เพิ่มวันหยุดในภาคเรียน' })
  create(
    @Param('termId', ParseIntPipe) termId: number,
    @Body() createHolidayDto: CreateHolidayDto,
  ) {
    return this.holidaysService.create(termId, createHolidayDto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.STUDENT, Role.PARENT)
  @ApiOperation({ summary: 'ดูวันหยุดทั้งหมดในภาคเรียน' })
  findAll(@Param('termId', ParseIntPipe) termId: number) {
    return this.holidaysService.findAll(termId);
  }

  @Patch(':holidayId')
  @ApiOperation({ summary: 'แก้ไขวันหยุดในภาคเรียน' })
  update(
    @Param('termId', ParseIntPipe) termId: number,
    @Param('holidayId', ParseIntPipe) holidayId: number,
    @Body() updateHolidayDto: UpdateHolidayDto,
  ) {
    return this.holidaysService.update(termId, holidayId, updateHolidayDto);
  }

  @Delete(':holidayId')
  @ApiOperation({ summary: 'ลบวันหยุดในภาคเรียน' })
  remove(
    @Param('termId', ParseIntPipe) termId: number,
    @Param('holidayId', ParseIntPipe) holidayId: number,
  ) {
    return this.holidaysService.remove(termId, holidayId);
  }
}

@ApiTags('Academic Holidays')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
@Controller('terms/:termId/calendar')
export class TermCalendarController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get()
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.STUDENT, Role.PARENT)
  @ApiOperation({ summary: 'ดูปฏิทินวันเรียนของภาคเรียนรายเดือน' })
  @ApiQuery({
    name: 'month',
    example: '2026-07',
    description: 'เดือนที่ต้องการดู รูปแบบ YYYY-MM',
  })
  getCalendar(
    @Param('termId', ParseIntPipe) termId: number,
    @Query('month') month: string,
  ) {
    return this.holidaysService.getCalendar(termId, month);
  }
}
