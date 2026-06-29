import { IsString, IsNotEmpty, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateParentDto {
    @ApiProperty({ example: '3103542634212', description: 'รหัสประจำตัวประชาชนผู้ปกครอง' })
    @IsString()
    @IsNotEmpty()
    citizenId!: string;

    @ApiProperty({ example: 'สมเกียรติ', description: 'ชื่อจริงผู้ปกครอง' })
    @IsString()
    @IsNotEmpty()
    firstName!: string;

    @ApiProperty({ example: 'รักเรียน', description: 'นามสกุลผู้ปกครอง' })
    @IsString()
    @IsNotEmpty()
    lastName!: string;

    @ApiProperty({ example: 'password123', description: 'รหัสผ่าน' })
    @IsString()
    @MinLength(6, { message: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' })
    password!: string;

    @ApiProperty({ example: '110xxxxxxxxxx', description: 'รหัสประชาชน/รหัสนักเรียน ของบุตรหลาน' })
    @IsString()
    @IsNotEmpty({ message: 'กรุณาระบุรหัสบุตรหลานเพื่อเชื่อมโยงข้อมูล' })
    studentCitizenId!: string;

    @ApiPropertyOptional({ example: 'U1234567890abcdef...', description: 'LINE User ID (ส่งมาอัตโนมัติถ้าเปิดผ่าน LINE Mini App)' })
    @IsOptional()
    @IsString()
    lineUserId?: string;
}