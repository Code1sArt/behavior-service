import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { TermsService } from './terms.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Academic Terms')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
@Controller('terms')
export class TermsController {
  constructor(private readonly termsService: TermsService) {}

  @Post()
  @ApiOperation({ summary: 'สร้างภาคเรียนและปีการศึกษาใหม่' })
  create(@Body() createTermDto: CreateTermDto) {
    return this.termsService.create(createTermDto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.STUDENT, Role.PARENT)
  @ApiOperation({ summary: 'ดูรายชื่อภาคเรียน/ปีการศึกษาทั้งหมด' })
  findAll() {
    return this.termsService.findAll();
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.TEACHER, Role.AFFAIRS, Role.STUDENT, Role.PARENT)
  @ApiOperation({ summary: 'ดูข้อมูลภาคเรียนตาม ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.termsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขข้อมูลภาคเรียน' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTermDto: UpdateTermDto,
  ) {
    return this.termsService.update(id, updateTermDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบข้อมูลภาคเรียน' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.termsService.remove(id);
  }
}
