import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PhotographyBookingKind,
  PhotographyBookingStatus,
} from '@prisma/client';

export class PhotographySlotDto {
  @IsDateString({ strict: true }) startsAt!: string;
  @IsDateString({ strict: true }) endsAt!: string;
}
export class EquipmentRequestDto {
  @IsString() @MinLength(1) @MaxLength(191) equipmentId!: string;
  @IsInt() @Min(1) @Max(1000) quantity!: number;
}
export class CreatePhotographyBookingDto {
  @IsEnum(PhotographyBookingKind) kind!: PhotographyBookingKind;
  @IsString() @MinLength(1) @MaxLength(191) activityName!: string;
  @IsString() @MinLength(1) @MaxLength(500) location!: string;
  @IsString() @MinLength(1) @MaxLength(191) departmentId!: string;
  @IsBoolean() hasLunch!: boolean;
  @IsInt() @Min(0) @Max(50) photographerCount!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  @ValidateNested({ each: true })
  @Type(() => PhotographySlotDto)
  slots!: PhotographySlotDto[];
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique((item: EquipmentRequestDto) => item?.equipmentId)
  @ValidateNested({ each: true })
  @Type(() => EquipmentRequestDto)
  equipment!: EquipmentRequestDto[];
}
export class ApprovePhotographyBookingDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  studentIds!: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class PhotographyNoteDto {
  @IsString() @MinLength(1) @MaxLength(1000) note!: string;
}
export class PhotographyNameDto {
  @IsString() @MinLength(1) @MaxLength(191) name!: string;
}
export class PhotographyEquipmentDto extends PhotographyNameDto {
  @IsInt() @Min(1) @Max(1000) quantity!: number;
}
export class PhotographyActiveDto {
  @IsBoolean() active!: boolean;
}
export class PhotographyDirectoryQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum({ TEACHER: 'TEACHER', STUDENT: 'STUDENT' }) role?:
    | 'TEACHER'
    | 'STUDENT';
}
export class PhotographyListQuery {
  @IsOptional()
  @IsEnum(PhotographyBookingStatus)
  status?: PhotographyBookingStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page: number =
    1;
}
export class PhotographyCalendarQuery {
  @Matches(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/)
  month!: string;
}
