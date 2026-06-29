import { IsString, IsInt, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClassroomDto {
    @ApiProperty({ description: 'ชื่อห้องเรียน', example: 'ม.6/5' })
    @IsString()
    @IsNotEmpty()
    name!: string;

    @ApiPropertyOptional({ description: 'คะแนนเริ่มต้น', example: 100 })
    @IsOptional()
    @IsInt()
    startingPoints?: number;

    @ApiProperty({ description: 'เกณฑ์ตกค้าง', example: 60 })
    @IsInt()
    @IsNotEmpty()
    failingThreshold!: number;

    @ApiProperty({ description: 'เกณฑ์ได้เกียรติบัตร', example: 80 })
    @IsInt()
    @IsNotEmpty()
    certificateThreshold!: number;

    @ApiProperty({ description: 'เกณฑ์ได้โล่', example: 90 })
    @IsInt()
    @IsNotEmpty()
    shieldThreshold!: number;

    @ApiPropertyOptional({
        description: 'รายชื่อ ID ของครูที่ปรึกษา (สามารถใส่ได้หลายคน)',
        example: ['uuid-teacher-1', 'uuid-teacher-2']
    })
    @IsOptional()
    @IsArray() // บังคับว่าต้องส่งมาเป็น Array
    @IsString({ each: true }) // สมาชิกข้างใน Array ต้องเป็น String (UUID)
    advisorIds?: string[];

    @ApiPropertyOptional({ description: 'ID ของภาคเรียน (ถ้าไม่ใส่ ระบบจะใช้ภาคเรียนปัจจุบันอัตโนมัติ)' })
    @IsOptional()
    @IsInt()
    termId?: number; // <--- เพิ่มฟิลด์นี้
}