import { IsString, IsNotEmpty, IsInt, Min, IsEnum, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PointType } from '@prisma/client';

export class CreatePointCategoryDto {
  @ApiProperty({ example: 'ช่วยเหลืองานโรงเรียน', description: 'ชื่อหมวดหมู่คะแนน' })
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อหมวดหมู่' })
  name!: string;

  @ApiProperty({ enum: PointType, example: PointType.ADD, description: 'ประเภท (ADD = เพิ่ม, DEDUCT = หัก)' })
  @IsEnum(PointType, { message: 'ประเภทต้องเป็น ADD หรือ DEDUCT เท่านั้น' })
  type!: PointType;

  @ApiProperty({ example: 5, description: 'จำนวนคะแนนตั้งต้น' })
  @IsInt()
  @Min(1, { message: 'คะแนนต้องมากกว่า 0' })
  defaultPoints!: number;

  @ApiProperty({ example: true, description: 'อนุญาตให้ครูทั่วไปใช้งานหมวดนี้ได้' })
  @IsBoolean()
  allowedForTeacher!: boolean;

  @ApiProperty({ example: true, description: 'อนุญาตให้ฝ่ายกิจการนักเรียนใช้งานหมวดนี้ได้' })
  @IsBoolean()
  allowedForAffairs!: boolean;
}
