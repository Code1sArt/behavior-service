import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { Request as ExpressRequest } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ApplyAnnualPromotionDto,
  PreviewAnnualPromotionDto,
} from './dto/annual-promotion.dto';
import {
  ApplyTermRolloverDto,
  PreviewTermRolloverDto,
} from './dto/term-rollover.dto';
import { PromotionsService } from './promotions.service';
import {
  ApplyEnrollmentChangesDto,
  PreviewEnrollmentChangesDto,
} from './dto/enrollment-change.dto';

interface AuthenticatedRequest extends ExpressRequest {
  user: {
    userId: string;
    role: Role;
  };
}

@ApiTags('Academic Promotions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN)
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get('enrollment-changes/candidates')
  @ApiOperation({ summary: 'รายชื่อนักเรียนที่ย้าย/พักหรือรับกลับได้' })
  getEnrollmentChangeCandidates(@Query('termId', ParseIntPipe) termId: number) {
    return this.promotionsService.getEnrollmentChangeCandidates(termId);
  }

  @Post('enrollment-changes/preview')
  @ApiOperation({ summary: 'ตรวจสอบแผนย้ายออก พัก หรือรับกลับ' })
  previewEnrollmentChanges(@Body() dto: PreviewEnrollmentChangesDto) {
    return this.promotionsService.previewEnrollmentChanges(dto);
  }

  @Post('enrollment-changes/apply')
  @ApiOperation({ summary: 'ยืนยันย้ายออก พัก หรือรับกลับแบบ transaction' })
  applyEnrollmentChanges(
    @Body() dto: ApplyEnrollmentChangesDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.promotionsService.applyEnrollmentChanges(
      request.user.userId,
      dto,
    );
  }

  @Post('term-rollover/preview')
  @ApiOperation({
    summary: 'ตรวจสอบแผนเปลี่ยนภาคเรียนโดยไม่เขียนฐานข้อมูล',
  })
  previewTermRollover(@Body() dto: PreviewTermRolloverDto) {
    return this.promotionsService.previewTermRollover(dto);
  }

  @Post('term-rollover/apply')
  @ApiOperation({
    summary: 'เปลี่ยนภาคเรียนทั้งโรงเรียนแบบ transaction',
  })
  applyTermRollover(
    @Body() dto: ApplyTermRolloverDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.promotionsService.applyTermRollover(request.user.userId, dto);
  }

  @Post('annual/preview')
  @ApiOperation({
    summary: 'ตรวจสอบแผนเลื่อนชั้นประจำปีโดยไม่เขียนฐานข้อมูล',
  })
  previewAnnualPromotion(@Body() dto: PreviewAnnualPromotionDto) {
    return this.promotionsService.previewAnnualPromotion(dto);
  }

  @Post('annual/apply')
  @ApiOperation({
    summary: 'เลื่อนชั้นประจำปีทั้งโรงเรียนแบบ transaction',
  })
  applyAnnualPromotion(
    @Body() dto: ApplyAnnualPromotionDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.promotionsService.applyAnnualPromotion(
      request.user.userId,
      dto,
    );
  }
}
