import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { PhotographyService } from './photography.service';
import {
  ApprovePhotographyBookingDto,
  CreatePhotographyBookingDto,
  PhotographyActiveDto,
  PhotographyCalendarQuery,
  PhotographyDirectoryQuery,
  PhotographyEquipmentDto,
  PhotographyListQuery,
  PhotographyNameDto,
  PhotographyNoteDto,
} from './photography.dto';

type AuthRequest = { user: { userId: string; role: Role } };
@Controller('photography')
@UseGuards(AuthGuard('jwt'))
export class PhotographyController {
  constructor(private readonly service: PhotographyService) {}
  @Get('metadata') metadata(@Request() req: AuthRequest) {
    return this.service.metadata(req.user);
  }
  @Get('managers') managers(@Request() req: AuthRequest) {
    return this.service.managers(req.user);
  }
  @Patch('managers/:userId') manager(
    @Request() req: AuthRequest,
    @Param('userId') id: string,
    @Body() dto: PhotographyActiveDto,
  ) {
    return this.service.setManager(req.user, id, dto.active);
  }
  @Get('directory') directory(
    @Request() req: AuthRequest,
    @Query() query: PhotographyDirectoryQuery,
  ) {
    return this.service.directory(req.user, query.role ?? 'STUDENT', query.q);
  }
  @Get('photographers') photographers(@Request() req: AuthRequest) {
    return this.service.photographers(req.user);
  }
  @Patch('photographers/:userId') photographer(
    @Request() req: AuthRequest,
    @Param('userId') id: string,
    @Body() dto: PhotographyActiveDto,
  ) {
    return this.service.setPhotographer(req.user, id, dto.active);
  }
  @Post('departments') department(
    @Request() req: AuthRequest,
    @Body() dto: PhotographyNameDto,
  ) {
    return this.service.saveDepartment(req.user, dto.name);
  }
  @Patch('departments/:id') departmentActive(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: PhotographyActiveDto,
  ) {
    return this.service.setDepartmentActive(req.user, id, dto.active);
  }
  @Post('equipment') equipment(
    @Request() req: AuthRequest,
    @Body() dto: PhotographyEquipmentDto,
  ) {
    return this.service.saveEquipment(req.user, dto.name, dto.quantity);
  }
  @Patch('equipment/:id') equipmentActive(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: PhotographyActiveDto,
  ) {
    return this.service.setEquipmentActive(req.user, id, dto.active);
  }
  @Get('bookings') list(
    @Request() req: AuthRequest,
    @Query() query: PhotographyListQuery,
  ) {
    return this.service.list(req.user, query);
  }
  @Get('calendar') calendar(
    @Request() req: AuthRequest,
    @Query() query: PhotographyCalendarQuery,
  ) {
    return this.service.calendar(req.user, query);
  }
  @Post('bookings') create(
    @Request() req: AuthRequest,
    @Body() dto: CreatePhotographyBookingDto,
  ) {
    return this.service.create(req.user, dto);
  }
  @Get('bookings/:id') detail(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.service.detail(req.user, id);
  }
  @Get('bookings/:id/availability') availability(
    @Request() req: AuthRequest,
    @Param('id') id: string,
  ) {
    return this.service.availability(req.user, id);
  }
  @Post('bookings/:id/approve') approve(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: ApprovePhotographyBookingDto,
  ) {
    return this.service.approve(req.user, id, dto);
  }
  @Post('bookings/:id/reject') reject(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: PhotographyNoteDto,
  ) {
    return this.service.reject(req.user, id, dto.note);
  }
  @Post('bookings/:id/cancel') cancel(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: PhotographyNoteDto,
  ) {
    return this.service.cancel(req.user, id, dto.note);
  }
}
