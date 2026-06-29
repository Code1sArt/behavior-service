import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx';
import 'multer';
import { CreateStaffDto } from './dto/create-staff.dto';

@Injectable()
export class TeachersService {
    constructor(private prisma: PrismaService) { }




    // 1. ฟังก์ชันเพิ่มบุคลากรทีละคน
    async createStaff(dto: CreateStaffDto) {
        // เช็คว่ามีคนใช้รหัสนี้ไปหรือยัง
        const existingUser = await this.prisma.user.findUnique({
            where: { citizenId: dto.citizenId },
        });
        if (existingUser) {
            throw new ConflictException('รหัสประจำตัวนี้มีอยู่ในระบบแล้ว');
        }

        // เข้ารหัสผ่าน (ถ้าไม่ส่งมา ให้ใช้ รหัสประจำตัว เป็นรหัสผ่านเริ่มต้น)
        const salt = await bcrypt.genSalt();
        const rawPassword = dto.password || dto.citizenId;
        const hashedPassword = await bcrypt.hash(rawPassword, salt);

        const newStaff = await this.prisma.user.create({
            data: {
                citizenId: dto.citizenId,
                firstName: dto.firstName,
                lastName: dto.lastName,
                role: dto.role,
                password: hashedPassword,
            },
        });

        delete (newStaff as any).password;
        return newStaff;
    }


    // 2. ฟังก์ชันอัปโหลดผ่าน Excel
    async createStaffFromExcel(file: Express.Multer.File) {
        if (!file) throw new BadRequestException('กรุณาอัปโหลดไฟล์ Excel');

        try {
            // อ่านไฟล์ Excel จาก Buffer ในหน่วยความจำ
            const workbook = XLSX.read(file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0]; // อ่านชีตแรก
            const sheet = workbook.Sheets[sheetName];

            // แปลงข้อมูลเป็น JSON (สมมติว่าหัวคอลัมน์คือ citizenId, firstName, lastName, role)
            const data = XLSX.utils.sheet_to_json(sheet) as any[];

            if (data.length === 0) {
                throw new BadRequestException('ไม่พบข้อมูลในไฟล์ Excel');
            }

            let successCount = 0;
            let failCount = 0;
            const failedRows: { citizenId: string | number | null; error: string }[] = [];

            // วนลูปบันทึกข้อมูล (ใช้ลูปเพื่อกรองคนซ้ำออก และเข้ารหัสผ่านทีละคน)
            const salt = await bcrypt.genSalt();

            for (const row of data) {
                try {
                    // ตรวจสอบข้อมูลเบื้องต้น
                    if (!row.citizenId || !row.firstName || !row.lastName) {
                        throw new Error('ข้อมูลไม่ครบถ้วน');
                    }

                    // จัดการ Role (ถ้าไม่ใส่มาหรือใส่ผิด ให้เป็น TEACHER ทั่วไป)
                    let userRole: Role = Role.TEACHER;
                    if (row.role === 'ADMIN') userRole = Role.ADMIN;
                    if (row.role === 'AFFAIRS') userRole = Role.AFFAIRS;

                    // เข้ารหัสผ่านโดยใช้ citizenId เป็นค่าเริ่มต้น
                    const hashedPassword = await bcrypt.hash(row.citizenId.toString(), salt);

                    // บันทึกลงฐานข้อมูล
                    await this.prisma.user.create({
                        data: {
                            citizenId: row.citizenId.toString(),
                            firstName: row.firstName,
                            lastName: row.lastName,
                            role: userRole,
                            password: hashedPassword,
                        },
                    });
                    successCount++;
                } catch (error: any) {
                    failCount++;
                    failedRows.push({ citizenId: row.citizenId, error: error.message || 'รหัสซ้ำ' });
                }
            }

            return {
                message: 'ประมวลผลไฟล์ Excel เสร็จสิ้น',
                summary: {
                    total: data.length,
                    success: successCount,
                    failed: failCount,
                },
                errors: failedRows, // ส่งรายการที่พังกลับไปให้แอดมินดูด้วย
            };
        } catch (error) {
            throw new BadRequestException('รูปแบบไฟล์ Excel ไม่ถูกต้อง');
        }
    }


    // ดึงรายชื่อบุคลากรทั้งหมด
    async findAllStaff() {
        return this.prisma.user.findMany({
            where: {
                // กรองเอาเฉพาะ Role ที่เป็นบุคลากรโรงเรียน
                role: {
                    in: [Role.TEACHER, Role.AFFAIRS],
                },
            },
            // เลือกคืนค่าเฉพาะฟิลด์ที่จำเป็น (ไม่คืนค่า password!)
            select: {
                id: true,
                citizenId: true,
                firstName: true,
                lastName: true,
                role: true,
                lineUserId: true,
            },
            // เรียงตามชื่อ ก-ฮ
            orderBy: {
                firstName: 'asc',
            },
        });
    }


}