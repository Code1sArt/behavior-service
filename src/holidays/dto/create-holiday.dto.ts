import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateHolidayDto {
  @ApiProperty({
    example: '2026-01-01',
    description: 'วันที่หยุด รูปแบบ YYYY-MM-DD',
  })
  @IsDateString({}, { message: 'รูปแบบวันหยุดไม่ถูกต้อง' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'วันหยุดต้องอยู่ในรูปแบบ YYYY-MM-DD',
  })
  @IsNotEmpty({ message: 'กรุณากรอกวันหยุด' })
  date!: string;

  @ApiProperty({
    example: 'วันขึ้นปีใหม่',
    description: 'ชื่อวันหยุด',
  })
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อวันหยุด' })
  name!: string;
}
