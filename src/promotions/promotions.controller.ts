import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
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
