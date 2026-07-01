import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PromotionAction } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TermRolloverStudentOverrideDto } from './term-rollover.dto';

export class AnnualClassroomMappingDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  sourceClassroomId!: number;

  @ApiPropertyOptional({
    description:
      'ชื่อห้องปลายทาง ต้องระบุเมื่อ defaultAction เป็น MOVE หรือมีนักเรียนย้ายเข้าห้องนี้',
    example: 'ม.2/1',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  targetName?: string;

  @ApiProperty({
    enum: PromotionAction,
    example: PromotionAction.MOVE,
    description: 'รองรับ MOVE, GRADUATE, TRANSFER_OUT หรือ SKIP',
  })
  @IsEnum(PromotionAction)
  defaultAction!: PromotionAction;
}

export class PreviewAnnualPromotionDto {
  @ApiProperty({ example: 2 })
  @IsInt()
  sourceTermId!: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  targetTermId!: number;

  @ApiProperty({ type: [AnnualClassroomMappingDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AnnualClassroomMappingDto)
  classroomMappings!: AnnualClassroomMappingDto[];

  @ApiPropertyOptional({ type: [TermRolloverStudentOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermRolloverStudentOverrideDto)
  studentOverrides?: TermRolloverStudentOverrideDto[];
}

export class ApplyAnnualPromotionDto extends PreviewAnnualPromotionDto {
  @ApiProperty({
    description: 'คีย์ป้องกันการกด Apply ซ้ำ เช่น UUID จากหน้า Admin',
  })
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  activateTargetTerm?: boolean = true;
}
