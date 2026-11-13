import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffAttendanceType } from '@prisma/client';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStaffAttendanceDto {
  @ApiProperty({ enum: StaffAttendanceType, example: 'SICK_LEAVE' })
  @IsEnum(StaffAttendanceType)
  type!: StaffAttendanceType;

  @ApiProperty({
    example: '2026-11-13',
    description: 'วันที่แจ้ง รูปแบบ YYYY-MM-DD',
  })
  @IsString()
  @Matches(DATE_PATTERN)
  date!: string;

  @ApiPropertyOptional({
    example: '09:30',
    description:
      'เวลาที่คาดว่าจะมาถึง รูปแบบ HH:mm (บังคับเมื่อเป็น LATE_ARRIVAL)',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN)
  arrivalTime?: string;

  @ApiProperty({ example: 'มีไข้และต้องไปพบแพทย์' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class StaffAttendanceHistoryQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  to?: string;
}

export class DailyStaffAttendanceQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-13',
    description: 'ไม่ระบุจะใช้วันที่ปัจจุบันตามเวลา Asia/Bangkok',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  date?: string;
}
