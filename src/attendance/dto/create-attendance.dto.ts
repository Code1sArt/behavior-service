import { IsString, IsNotEmpty, IsEnum, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AttendanceType, AttendanceStatus } from '@prisma/client';

class StudentAttendanceDto {
    @ApiProperty({ example: 'uuid-ของนักเรียน' })
    @IsString()
    @IsNotEmpty()
    studentId!: string;

    @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
    @IsEnum(AttendanceStatus)
    status!: AttendanceStatus;
}

export class CreateBulkAttendanceDto {
    @ApiProperty({ enum: AttendanceType, example: AttendanceType.AREA })
    @IsEnum(AttendanceType)
    type!: AttendanceType;

    @ApiProperty({ type: [StudentAttendanceDto] })
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StudentAttendanceDto)
    records!: StudentAttendanceDto[];
}

export class UpdateAttendanceDto {
    @ApiProperty({ enum: AttendanceStatus })
    @IsEnum(AttendanceStatus)
    @IsNotEmpty()
    status!: AttendanceStatus;
}