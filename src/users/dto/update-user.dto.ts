import { IsString, IsOptional, IsInt, IsEnum, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
    @ApiPropertyOptional({ description: 'หมายเลขบัตรประชาชน', example: '1234567890123' })
    @IsOptional()
    @IsString()
    citizenId?: string;

    @ApiPropertyOptional({ description: 'ชื่อ', example: 'John' })
    @IsOptional()
    @IsString()
    firstName?: string;

    @ApiPropertyOptional({ description: 'นามสกุล', example: 'Doe' })
    @IsOptional()
    @IsString()
    lastName?: string;

    @ApiPropertyOptional({ description: 'รหัสผ่านใหม่ (ถ้ามีการเปลี่ยน)', example: 'newpassword123' })
    @IsOptional()
    @IsString()
    @MinLength(6, { message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' })
    password?: string;

    @ApiPropertyOptional({ description: 'ไอดีไลน์', example: 'line_user_id' })
    @IsOptional()
    @IsString()
    lineUserId?: string;

    @ApiPropertyOptional({ description: 'บทบาท', enum: Role, example: Role.STUDENT })
    @IsOptional()
    @IsEnum(Role)
    role?: Role;

    @ApiPropertyOptional({ description: 'ไอดีห้องเรียน', example: 1 })
    @IsOptional()
    @IsInt()
    classroomId?: number;

    @ApiPropertyOptional({ description: 'ไอดีผู้ปกครอง', example: 'parent_id' })
    @IsOptional()
    @IsString()
    parentId?: string;
}