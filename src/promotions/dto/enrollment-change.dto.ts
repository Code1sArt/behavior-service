import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EnrollmentChangeAction } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnrollmentChangeItemDto {
  @ApiProperty({ example: 'student-uuid' })
  @IsString()
  studentId!: string;

  @ApiProperty({ enum: EnrollmentChangeAction })
  @IsEnum(EnrollmentChangeAction)
  action!: EnrollmentChangeAction;

  @ApiPropertyOptional({
    example: 10,
    description: 'บังคับระบุเมื่อ action เป็น RETURN_TO_STUDY',
  })
  @IsOptional()
  @IsInt()
  targetClassroomId?: number;
}

export class PreviewEnrollmentChangesDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  termId!: number;

  @ApiProperty({ type: [EnrollmentChangeItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => EnrollmentChangeItemDto)
  changes!: EnrollmentChangeItemDto[];
}

export class ApplyEnrollmentChangesDto extends PreviewEnrollmentChangesDto {
  @ApiProperty({ description: 'คีย์ป้องกันการกด Apply ซ้ำ' })
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
