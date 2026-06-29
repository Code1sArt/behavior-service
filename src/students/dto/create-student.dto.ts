import { IsString, IsNotEmpty, IsOptional, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateStudentDto {
    @ApiProperty({ example: '254842', description: 'รหัสประจำตัวประชาชน หรือ รหัสนักเรียน' })
    @IsString()
    @IsNotEmpty()
    citizenId!: string;

    @ApiProperty({ example: 'มานะ', description: 'ชื่อจริง' })
    @IsString()
    @IsNotEmpty()
    firstName!: string;

    @ApiProperty({ example: 'อดทน', description: 'นามสกุล' })
    @IsString()
    @IsNotEmpty()
    lastName!: string;

    @ApiProperty({ example: 'password123', description: 'รหัสผ่านเริ่มต้น' })
    @IsString()
    @IsNotEmpty()
    password!: string;

    @ApiProperty({ example: 1, description: 'ID ของห้องเรียน' })
    @IsInt()
    @IsNotEmpty()
    classroomId!: number;


    @ApiProperty({ example: 'U1234567890abcdef', description: 'LINE User ID ของนักเรียน (ถ้ามี)' })
    @IsString()
    @IsOptional()
    lineUserId?: string; // เพิ่มฟิลด์นี้เพื่อเก็บ LINE User ID ของนักเรียน (ถ้ามี)
}