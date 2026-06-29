import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class CreateStaffDto {
    @ApiProperty({ example: '1199900012345' })
    @IsString()
    @IsNotEmpty()
    citizenId!: string;

    @ApiProperty({ example: 'สิทธิพล' })
    @IsString()
    @IsNotEmpty()
    firstName!: string;

    @ApiProperty({ example: 'ฉัตรวงศ์ศรี' })
    @IsString()
    @IsNotEmpty()
    lastName!: string;

    @ApiProperty({ enum: [Role.TEACHER, Role.AFFAIRS, Role.ADMIN], example: Role.TEACHER })
    @IsEnum(Role)
    @IsNotEmpty()
    role!: Role;

    @ApiPropertyOptional({ description: 'ถ้าไม่ระบุ ระบบจะใช้ citizenId เป็นรหัสผ่านเริ่มต้น' })
    @IsOptional()
    @IsString()
    password?: string;
}