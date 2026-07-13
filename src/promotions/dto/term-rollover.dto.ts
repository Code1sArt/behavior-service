import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayNotEmpty,
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

export class TermRolloverClassroomMappingDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  sourceClassroomId!: number;

  @ApiPropertyOptional({ example: 'ม.1/1' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  targetName?: string;
}

export class TermRolloverStudentOverrideDto {
  @ApiProperty({ example: 'student-uuid' })
  @IsString()
  studentId!: string;

  @ApiProperty({ enum: PromotionAction, example: PromotionAction.MOVE })
  @IsEnum(PromotionAction)
  action!: PromotionAction;

  @ApiPropertyOptional({
    description: 'ห้องต้นทางที่ใช้ระบุห้องเป้าหมายหลังคัดลอก',
    example: 11,
  })
  @IsOptional()
  @IsInt()
  targetSourceClassroomId?: number;
}

export class PreviewTermRolloverDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  sourceTermId!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  targetTermId!: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'ห้องต้นทางที่ผู้ดูแลเลือกดำเนินการ',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  selectedClassroomIds?: number[];

  @ApiPropertyOptional({ type: [TermRolloverClassroomMappingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermRolloverClassroomMappingDto)
  classroomMappings?: TermRolloverClassroomMappingDto[];

  @ApiPropertyOptional({ type: [TermRolloverStudentOverrideDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermRolloverStudentOverrideDto)
  studentOverrides?: TermRolloverStudentOverrideDto[];
}

export class ApplyTermRolloverDto extends PreviewTermRolloverDto {
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
