import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAttendanceTimeDto } from './dto/update-config.dto';

@Injectable()
export class SettingsService {
    constructor(private prisma: PrismaService) { }

    // ค่าคงที่ของ Key ใน Database
    private readonly CUTOFF_TIME_KEY = 'ATTENDANCE_CUTOFF_TIME';
    // เวลา Default ในกรณีที่แอดมินยังไม่เคยเข้ามาตั้งค่า
    private readonly DEFAULT_TIME = '08:30';

    // ฟังก์ชันดึงเวลาปัจจุบัน
    async getAttendanceCutoffTime() {
        const config = await this.prisma.systemConfig.findUnique({
            where: { key: this.CUTOFF_TIME_KEY },
        });

        return {
            cutoffTime: config ? config.value : this.DEFAULT_TIME,
        };
    }

    // ฟังก์ชันอัปเดตเวลา
    async updateAttendanceCutoffTime(dto: UpdateAttendanceTimeDto) {
        const updatedConfig = await this.prisma.systemConfig.upsert({
            where: { key: this.CUTOFF_TIME_KEY },
            update: { value: dto.time },
            create: { key: this.CUTOFF_TIME_KEY, value: dto.time },
        });

        return {
            message: 'อัปเดตเวลาตัดยอดเช็คชื่อสำเร็จ',
            cutoffTime: updatedConfig.value,
        };
    }
}