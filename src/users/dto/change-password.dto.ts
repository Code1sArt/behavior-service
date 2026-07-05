import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @ApiProperty({ description: 'รหัสผ่านปัจจุบัน' })
    @IsString()
    oldPassword: string;

    @ApiProperty({ description: 'รหัสผ่านใหม่', minLength: 6 })
    @IsString()
    @MinLength(6, { message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' })
    newPassword: string;
}
