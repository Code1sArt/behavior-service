import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBehaviorDto, CreateBulkBehaviorDto } from './dto/create-behavior.dto';
import { PointType, Role } from '@prisma/client';
import { LineService } from '../line/line.service'; // <--- 1. นำเข้า 
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import 'multer';
import { calculateLegacyPointDelta } from '../points/score-calculator';
import {
    requireStudentAcademicContext,
    requireStudentAcademicContexts,
} from '../students/student-academic-context';

@Injectable()
export class BehaviorsService {
    constructor(
        private prisma: PrismaService,
        private lineService: LineService) { }

    async create(recorderId: string, recorderRole: Role, dto: CreateBehaviorDto) {
        // 1. ตรวจสอบว่ามีหมวดหมู่นี้อยู่จริงหรือไม่
        const category = await this.prisma.pointCategory.findUnique({
            where: { id: dto.categoryId },
        });

        if (!category) {
            throw new NotFoundException('ไม่พบหมวดหมู่คะแนนนี้');
        }

        // 2. ตรวจสอบสิทธิ์การให้คะแนน (Permission Check)
        if (recorderRole === Role.TEACHER && !category.allowedForTeacher) {
            throw new ForbiddenException('ครูทั่วไปไม่มีสิทธิ์บันทึกคะแนนในหมวดหมู่นี้');
        }
        if (recorderRole === Role.AFFAIRS && !category.allowedForAffairs) {
            throw new ForbiddenException('ฝ่ายกิจการไม่มีสิทธิ์บันทึกคะแนนในหมวดหมู่นี้');
        }
        const context = await requireStudentAcademicContext(
            this.prisma,
            dto.studentId,
        );

        // 3. บันทึกข้อมูล (ดึงคะแนนตั้งต้นจากหมวดหมู่มาล็อคไว้)
        return this.prisma.behaviorRecord.create({
            data: {
                points: category.defaultPoints, // ล็อคค่าคะแนนตามหมวดหมู่ ณ เวลานั้น
                note: dto.note,
                categoryId: dto.categoryId,
                studentId: dto.studentId,
                recorderId: recorderId,
                pointDelta: calculateLegacyPointDelta({
                    points: category.defaultPoints,
                    category,
                }),
                classroomId: context.classroomId,
                termId: context.termId,
            },
            include: {
                category: true, // ส่งข้อมูลหมวดหมู่กลับไปให้หน้าบ้านโชว์ด้วย
            }
        });
    }

    // ดึงประวัติพฤติกรรมของนักเรียนรายบุคคล
    async findByStudent(studentId: string) {
        return this.prisma.behaviorRecord.findMany({
            where: { studentId },
            orderBy: { createdAt: 'desc' },
            include: {
                category: true,
                recorder: { select: { firstName: true, lastName: true, role: true } },
            },
        });
    }

    async createBulk(recorderId: string, recorderRole: Role, dto: CreateBulkBehaviorDto) {
        // 1. ตรวจสอบว่ามีหมวดหมู่นี้อยู่จริงหรือไม่
        const category = await this.prisma.pointCategory.findUnique({
            where: { id: dto.categoryId },
        });

        if (!category) throw new NotFoundException('ไม่พบหมวดหมู่คะแนนนี้');

        // 2. ตรวจสอบสิทธิ์การให้คะแนน
        if (recorderRole === Role.TEACHER && !category.allowedForTeacher) {
            throw new ForbiddenException('ครูทั่วไปไม่มีสิทธิ์บันทึกคะแนนในหมวดหมู่นี้');
        }
        if (recorderRole === Role.AFFAIRS && !category.allowedForAffairs) {
            throw new ForbiddenException('ฝ่ายกิจการไม่มีสิทธิ์บันทึกคะแนนในหมวดหมู่นี้');
        }
        const contexts = await requireStudentAcademicContexts(
            this.prisma,
            dto.studentIds,
        );

        // 3. เตรียมข้อมูลก้อนใหญ่สำหรับบันทึกลง Database
        const recordsToCreate = dto.studentIds.map(studentId => {
            const context = contexts.get(studentId)!;
            return {
                points: category.defaultPoints,
                note: dto.note,
                categoryId: dto.categoryId,
                studentId: studentId,
                recorderId: recorderId,
                pointDelta: calculateLegacyPointDelta({
                    points: category.defaultPoints,
                    category,
                }),
                classroomId: context.classroomId,
                termId: context.termId,
            };
        });

        // ใช้ createMany เพื่อความเร็วสูงสุด (ยิงเข้า DB ครั้งเดียว)
        const result = await this.prisma.behaviorRecord.createMany({
            data: recordsToCreate,
        });

        // 4. --- โซนแจ้งเตือน LINE ทำงานเบื้องหลัง ---
        // ดึงข้อมูลนักเรียนกลุ่มนี้มาเพื่อเอา lineUserId
        const studentsToNotify = await this.prisma.user.findMany({
            where: { id: { in: dto.studentIds } },
            select: { id: true, firstName: true, lastName: true, lineUserId: true }
        });

        for (const student of studentsToNotify) {
            if (student.lineUserId) {
                // เช็คว่าเป็นหมวดหมู่เพิ่มคะแนน หรือหักคะแนน เพื่อใช้คำให้ถูกต้อง
                const actionText = category.type === PointType.ADD ? 'ได้รับคะแนนบวก' : 'ถูกหักคะแนน';
                const msg = `[แจ้งเตือนพฤติกรรม] ด.ช./ด.ญ. ${student.firstName} ${student.lastName} ${actionText} ${category.defaultPoints} คะแนน\n\nสาเหตุ: ${category.name}\n${dto.note ? 'หมายเหตุ: ' + dto.note : ''}`;

                // ส่ง LINE แบบ Fire-and-Forget
                this.lineService.sendPushMessage(student.lineUserId, msg);
            }
        }

        return {
            message: `บันทึกคะแนนให้กลุ่มนักเรียนสำเร็จ ${result.count} รายการ`,
            count: result.count
        };
    }

    // ลบการบันทึก (กรณีที่ครูกดผิด)
    async remove(id: string, requesterId: string, requesterRole: Role) {
        const record = await this.prisma.behaviorRecord.findUnique({
            where: { id },
        });

        if (!record) {
            throw new NotFoundException('ไม่พบประวัติการบันทึกนี้');
        }

        // กฎการลบ: ให้เฉพาะ ADMIN หรือ "คนที่บันทึกรายการนั้นเอง" เป็นคนลบได้
        if (requesterRole !== Role.ADMIN && record.recorderId !== requesterId) {
            throw new ForbiddenException('คุณไม่มีสิทธิ์ลบประวัติการบันทึกของผู้อื่น');
        }

        return this.prisma.behaviorRecord.delete({
            where: { id },
        });
    }

    // ดึงประวัติพฤติกรรมทั้งหมด พร้อมตัวกรอง
    async getBehaviorHistory(dateStr?: string, classroomId?: number, studentId?: string, termId?: number) {
        // 1. จัดการตัวกรองวันที่ (ถ้ามีการส่งมา)
        let dateFilter: any = undefined;
        if (dateStr) {
            const targetDate = dayjs.tz(dateStr, 'YYYY-MM-DD', 'Asia/Bangkok');
            dateFilter = {
                gte: targetDate.startOf('day').toDate(),
                lte: targetDate.endOf('day').toDate(),
            };
        }

        const whereFilter: any = {
            AND: [
                // กรองจาก snapshot ณ เวลาที่บันทึก ไม่ใช่ห้องปัจจุบันของนักเรียน
                termId ? { termId: Number(termId) } : {},

                classroomId ? { classroomId: Number(classroomId) } : {},

                // 3. กรองรายบุคคล
                studentId ? { studentId: studentId } : {},

                // 4. กรองวันที่ (ถ้าส่งมา)
                dateStr ? {
                    createdAt: {
                        gte: dayjs.tz(dateStr, 'Asia/Bangkok').startOf('day').toDate(),
                        lte: dayjs.tz(dateStr, 'Asia/Bangkok').endOf('day').toDate(),
                    }
                } : {},
            ]
        };
        // 2. ค้นหาข้อมูลจาก Prisma
        const records = await this.prisma.behaviorRecord.findMany({
            where: whereFilter,
            include: {
                // ดึงข้อมูลนักเรียนและห้องเรียน
                student: {
                    select: {
                        id: true,
                        citizenId: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                classroom: { select: { name: true } },
                // ดึงชื่อผู้บันทึก (หรือระบบ)
                recorder: {
                    select: {
                        firstName: true,
                        lastName: true,
                    },
                },
                // ดึงชื่อหมวดหมู่ (ถ้าเป็น Null เพราะระบบหักอัตโนมัติ จะคืนค่า null อย่างปลอดภัย)
                category: {
                    select: {
                        name: true,
                        type: true,
                    },
                },
            },
            // เรียงลำดับจากล่าสุดไปเก่าสุด
            orderBy: {
                createdAt: 'desc',
            },
        });

        return records.map((record) => ({
            ...record,
            student: {
                ...record.student,
                // คง response shape เดิมให้ frontend ใช้งานต่อได้
                classroom: record.classroom ?? { name: 'ไม่ทราบห้อง' },
            },
        }));
    }


    async importFromExcel(file: Express.Multer.File, recorderId: string) {
        if (!file) throw new BadRequestException('กรุณาอัปโหลดไฟล์ Excel');
        if (!recorderId) throw new BadRequestException('ไม่พบข้อมูลผู้บันทึก กรุณา Login ใหม่');

        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet) as any[];

        const results = {
            total: data.length,
            success: 0,
            failed: 0,
            errors: [] as { citizenId: string; message: string }[],
        };

        for (const row of data) {
            try {
                const citizenIdStr = String(row.citizenId || '').trim();
                if (!citizenIdStr) throw new Error('ไม่พบข้อมูลรหัสประจำตัว (citizenId)');

                // 1. ค้นหานักเรียนจากรหัสประจำตัว
                const student = await this.prisma.user.findUnique({
                    where: { citizenId: citizenIdStr },
                });

                if (!student) throw new Error(`ไม่พบนักเรียนรหัส ${citizenIdStr} ในระบบ`);
                const context = await requireStudentAcademicContext(
                    this.prisma,
                    student.id,
                );
                const points = Number(row.points || 0);
                const categoryId = row.categoryId
                    ? Number(row.categoryId)
                    : null;
                const category = categoryId
                    ? await this.prisma.pointCategory.findUnique({
                        where: { id: categoryId },
                    })
                    : null;
                if (categoryId && !category) {
                    throw new Error(`ไม่พบหมวดหมู่คะแนน ID ${categoryId}`);
                }

                // 2. บันทึกคะแนนพฤติกรรมโดยใช้ connect
                await this.prisma.behaviorRecord.create({
                    data: {
                        points,
                        note: row.note || 'นำเข้าผ่านระบบ Excel',
                        studentId: student.id,
                        recorderId,
                        categoryId,
                        pointDelta: calculateLegacyPointDelta({
                            points,
                            category,
                        }),
                        classroomId: context.classroomId,
                        termId: context.termId,
                    },
                });

                results.success++;
            } catch (error: any) {
                results.failed++;
                results.errors.push({
                    citizenId: row.citizenId ? String(row.citizenId) : 'N/A',
                    message: error.message
                });
            }
        }

        return results;
    }

}
