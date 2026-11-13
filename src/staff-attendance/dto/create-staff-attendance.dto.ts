import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffAttendanceStatus, StaffAttendanceType } from '@prisma/client';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStaffAttendanceDto {
  @ApiProperty({ enum: StaffAttendanceType, example: 'SICK_LEAVE' })
  @IsEnum(StaffAttendanceType)
  type!: StaffAttendanceType;

  @ApiProperty({
    example: '2026-11-13',
    description: 'วันเริ่มต้น รูปแบบ YYYY-MM-DD',
  })
  @IsString()
  @Matches(DATE_PATTERN)
  startDate!: string;

  @ApiProperty({
    example: '2026-11-15',
    description:
      'วันสิ้นสุด รูปแบบ YYYY-MM-DD (เข้าสายต้องเป็นวันเดียวกับวันเริ่มต้น)',
  })
  @IsString()
  @Matches(DATE_PATTERN)
  endDate!: string;

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

export class StaffAttendanceStatisticsQueryDto {
  @ApiPropertyOptional({
    enum: ['FISCAL_YEAR', 'ALL'],
    default: 'FISCAL_YEAR',
  })
  @IsOptional()
  @IsIn(['FISCAL_YEAR', 'ALL'])
  scope?: 'FISCAL_YEAR' | 'ALL';

  @ApiPropertyOptional({
    example: 2027,
    description: 'ปีสิ้นสุดของรอบงบประมาณ (รองรับทั้ง ค.ศ. และ พ.ศ.)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(3000)
  fiscalYear?: number;
}

export class StaffAttendanceManagementQueryDto extends StaffAttendanceHistoryQueryDto {
  @ApiPropertyOptional({ enum: StaffAttendanceStatus })
  @IsOptional()
  @IsEnum(StaffAttendanceStatus)
  status?: StaffAttendanceStatus;

  @ApiPropertyOptional({ enum: StaffAttendanceType })
  @IsOptional()
  @IsEnum(StaffAttendanceType)
  type?: StaffAttendanceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teacherId?: string;
}

export class ReviewStaffAttendanceDto {
  @ApiProperty({
    enum: [StaffAttendanceStatus.APPROVED, StaffAttendanceStatus.REJECTED],
  })
  @IsIn([StaffAttendanceStatus.APPROVED, StaffAttendanceStatus.REJECTED])
  status!: StaffAttendanceStatus;

  @ApiPropertyOptional({ example: 'อนุมัติตามเอกสารที่แนบ' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
