import { IsString, IsNotEmpty, IsInt, IsOptional, ArrayNotEmpty, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBehaviorDto {
    @ApiProperty({ example: 'uuid-ของนักเรียน', description: 'ID ของนักเรียนที่ถูกบันทึก' })
    @IsString()
    @IsNotEmpty()
    studentId!: string;

    @ApiProperty({ example: 3, description: 'ID ของหมวดหมู่คะแนน (PointCategory)' })
    @IsInt()
    @IsNotEmpty()
    categoryId!: number;

    @ApiPropertyOptional({ example: 'เก็บกระเป๋าตังค์คืนเพื่อนได้', description: 'หมายเหตุเพิ่มเติม (ถ้ามี)' })
    @IsOptional()
    @IsString()
    note?: string;
}

export class CreateBulkBehaviorDto {
    @ApiProperty({
        example: ['uuid-1', 'uuid-2'],
        description: 'รายชื่อ ID นักเรียนทั้งหมดที่ต้องการบันทึก'
    })
    @IsArray()
    @ArrayNotEmpty() // บังคับว่าต้องมี ID นักเรียนอย่างน้อย 1 คนใน Array
    @IsString({ each: true })
    studentIds!: string[];

    @ApiProperty({ example: 3, description: 'ID ของหมวดหมู่คะแนน (PointCategory)' })
    @IsInt()
    @IsNotEmpty()
    categoryId!: number;

    @ApiPropertyOptional({ example: 'หนีเรียนวิชาคอมพิวเตอร์', description: 'หมายเหตุเพิ่มเติม (ถ้ามี)' })
    @IsOptional()
    @IsString()
    note?: string;
}