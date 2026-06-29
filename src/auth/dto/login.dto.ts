import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
    @IsString()
    @ApiProperty({ description: 'รหัสประจำตัวประชาชนหรือรหัสนักเรียน', example: '1319900407721' })
    @IsNotEmpty()
    citizenId!: string;

    @IsString()
    @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
    @IsNotEmpty()
    password!: string;
}

export class LineLoginDto {
    @IsString()
    @IsNotEmpty()
    lineUserId!: string;
}

export class BindLineDto {
    @IsString()
    @IsNotEmpty()
    citizenId!: string; // รหัสประจำตัว (นักเรียน/ครู/ผู้ปกครอง)

    @IsString()
    @IsNotEmpty()
    password!: string;

    @IsString()
    @IsNotEmpty()
    lineUserId!: string;
}
