import {
    IsInt,
    IsNotEmpty,
    IsBoolean,
    IsOptional,
    Min,
    Max,
    IsDateString,
    Matches
} from 'class-validator';
import {
    ApiProperty,
    ApiPropertyOptional
} from '@nestjs/swagger';

export class CreateTermDto {
    @ApiProperty({ example: 1, description: 'ภาคเรียน (เช่น 1 หรือ 2)' })
    @IsInt()
    @Min(1)
    @Max(2, { message: 'ภาคเรียนต้องเป็น 1 หรือ 2' })
    @IsNotEmpty({ message: 'กรุณากรอกภาคเรียน' })
    term!: number;

    @ApiProperty({ example: 2569, description: 'ปีการศึกษา (เช่น 2569)' })
    @IsInt()
    @Min(2500)
    @IsNotEmpty({ message: 'กรุณากรอกปีการศึกษา' })
    year!: number;

    @ApiProperty({
        example: '2023-01-01',
        description: 'วันที่เริ่มต้นของปีการศึกษา รูปแบบ YYYY-MM-DD',
    })
    @IsDateString({}, { message: 'รูปแบบวันที่เริ่มต้นของปีการศึกษาไม่ถูกต้อง' })
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันเริ่มต้นของปีการศึกษาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    @IsNotEmpty({ message: 'กรุณากรอกวันที่เริ่มต้นของปีการศึกษา' })
    startDate!: Date;

    @ApiProperty({
        example: '2023-12-31',
        description: 'วันที่สิ้นสุดของปีการศึกษา รูปแบบ YYYY-MM-DD',
    })
    @IsDateString({}, { message: 'รูปแบบวันที่สิ้นสุดของปีการศึกษาไม่ถูกต้อง' })
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'วันสิ้นสุดของปีการศึกษาต้องอยู่ในรูปแบบ YYYY-MM-DD' })
    @IsNotEmpty({ message: 'กรุณากรอกวันที่สิ้นสุดของปีการศึกษา' })
    endDate!: Date;

    @ApiPropertyOptional({ example: true, description: 'กำหนดให้เป็นเทอมปัจจุบันที่กำลังใช้งาน' })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}