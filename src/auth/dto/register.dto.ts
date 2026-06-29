import { IsString, IsNotEmpty, MinLength, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
    @IsString()
    @ApiProperty({ description: 'รหัสประจำตัวประชาชนหรือรหัสนักเรียน', example: '1234567890123' })
    @IsNotEmpty({ message: 'กรุณากรอกรหัสประจำตัวประชาชน/รหัสนักเรียน' })
    citizenId!: string;

    @IsString()
    @ApiProperty({ description: 'ชื่อ', example: 'John' })
    @IsNotEmpty({ message: 'กรุณากรอกชื่อ' })
    firstName!: string;

    @IsString()
    @ApiProperty({ description: 'นามสกุล', example: 'Doe' })
    @IsNotEmpty({ message: 'กรุณากรอกนามสกุล' })
    lastName!: string;

    @IsString()
    @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
    @MinLength(6, { message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' })
    password!: string;

    @IsEnum(Role, { message: 'Role ไม่ถูกต้อง (ต้องเป็น STUDENT, TEACHER, AFFAIRS, ADMIN, PARENT)' })
    @ApiProperty({ description: 'บทบาทของผู้ใช้งาน', example: Role.STUDENT })
    role!: Role;
}
