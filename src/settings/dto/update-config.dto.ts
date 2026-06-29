import { IsString, Matches, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAttendanceTimeDto {
    @ApiProperty({ example: '08:30', description: 'เวลาช้าที่สุดที่อนุญาตให้เช็คชื่อ (รูปแบบ HH:mm)' })
    @IsString()
    @IsNotEmpty()
    @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
        message: 'เวลาต้องอยู่ในรูปแบบ HH:mm เช่น 08:30 หรือ 15:00',
    })
    time!: string;
}