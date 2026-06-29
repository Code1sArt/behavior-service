import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddChildDto {
    @ApiProperty({ example: '110xxxxxxxxxx', description: 'รหัสประชาชน/รหัสนักเรียน ของบุตรหลานที่ต้องการเพิ่ม' })
    @IsString()
    @IsNotEmpty({ message: 'กรุณาระบุรหัสนักเรียน' })
    studentCitizenId!: string;

    @IsString()
    @IsOptional()
    parentId?: string; // <-- เพิ่มบรรทัดนี้ เพื่อให้ Admin ระบุ ID ผู้ปกครองได้
}