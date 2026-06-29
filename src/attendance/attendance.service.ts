import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBulkAttendanceDto, UpdateAttendanceDto } from './dto/create-attendance.dto';
import { AttendanceStatus, AttendanceType } from '@prisma/client';
import { LineService } from '../line/line.service'; // <--- 1. นำเข้า 
import { AcademicCalendarService } from '../academic-calendar/academic-calendar.service';

// นำเข้า dayjs และปลั๊กอินจัดการ Timezone
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class AttendanceService {
    private readonly LATE_CATEGORY_ID = 1;
    private readonly ABSENT_CATEGORY_ID = 2;
    private readonly TIMEZONE = 'Asia/Bangkok'; // ตั้งค่าเป็นโซนเวลาไทย
    logger: any;

    constructor(
        private prisma: PrismaService,
        private lineService: LineService,
        private academicCalendarService: AcademicCalendarService,
    ) { }

    private async getActiveTermSchoolDayStatus(targetDate: dayjs.Dayjs) {
        const activeTerm = await this.prisma.academicTerm.findFirst({
            where: { isActive: true },
        });

        if (!activeTerm) {
            throw new BadRequestException('ไม่พบเทอมปัจจุบัน');
        }

        const schoolDayStatus =
            await this.academicCalendarService.getSchoolDayStatus(
                activeTerm.id,
                targetDate,
            );

        return { activeTerm, schoolDayStatus };
    }

    // -------------------------------------------------------------
    // 1. ดึงประวัติการเช็คชื่อรายวัน (แยกตามห้อง และแบ่ง Type)
    // -------------------------------------------------------------
    async getDailyHistory(dateStr?: string, classroomId?: number, type?: AttendanceType) {
        // บังคับใช้โซนเวลาของไทย เพื่อแก้ปัญหาข้อมูลหายตอนรอยต่อเที่ยงคืน
        const targetDate = dateStr
            ? dayjs.tz(dateStr, 'YYYY-MM-DD', 'Asia/Bangkok')
            : dayjs().tz('Asia/Bangkok');

        const { schoolDayStatus } =
            await this.getActiveTermSchoolDayStatus(targetDate);

        if (!schoolDayStatus.isSchoolDay) {
            return {
                date: targetDate.format('YYYY-MM-DD'),
                isSchoolDay: false,
                reason: schoolDayStatus.reason,
                records: {
                    ASSEMBLY: [],
                    AREA: [],
                },
            };
        }

        const startOfDay = targetDate.startOf('day').toDate();
        const endOfDay = targetDate.endOf('day').toDate();

        const records = await this.prisma.attendanceRecord.findMany({
            where: {
                date: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
                type: type ? type : undefined, // ถ้าส่ง type มาก็กรอง ถ้าไม่ส่งมาคือดึงทั้งหมด
                student: {
                    classroomId: classroomId ? Number(classroomId) : undefined,
                },
            },
            include: {
                student: {
                    select: {
                        id: true,
                        citizenId: true,
                        firstName: true,
                        lastName: true,
                        classroom: { select: { name: true } },
                    },
                },
                recorder: {
                    select: { firstName: true, lastName: true },
                },
            },
            orderBy: [
                { student: { classroom: { name: 'asc' } } },
                { student: { firstName: 'asc' } },
            ],
        });

        // จัดกลุ่มแยกประเภท (ASSEMBLY / AREA) ส่งกลับไปให้หน้าบ้านใช้ง่ายๆ
        return {
            date: targetDate.format('YYYY-MM-DD'),
            isSchoolDay: true,
            reason: null,
            records: {
                ASSEMBLY: records.filter(r => r.type === AttendanceType.ASSEMBLY),
                AREA: records.filter(r => r.type === AttendanceType.AREA),
            }
        };
    }

    // -------------------------------------------------------------
    // 2. สรุปสถิติรายวัน (Dashboard) แยกเป็นห้อง และรองรับการแยก Type
    // -------------------------------------------------------------
    async getDailySummary(dateStr?: string, classroomId?: number, type?: AttendanceType) {
        const targetDate = dateStr
            ? dayjs.tz(dateStr, 'YYYY-MM-DD', 'Asia/Bangkok')
            : dayjs().tz('Asia/Bangkok');

        const { schoolDayStatus } =
            await this.getActiveTermSchoolDayStatus(targetDate);

        if (!schoolDayStatus.isSchoolDay) {
            return {
                date: targetDate.format('YYYY-MM-DD'),
                type: type || AttendanceType.ASSEMBLY,
                isSchoolDay: false,
                reason: schoolDayStatus.reason,
                summary: [],
            };
        }

        const startOfDay = targetDate.startOf('day').toDate();
        const endOfDay = targetDate.endOf('day').toDate();

        // Default เป็น ASSEMBLY (หน้าเสาธง) เพื่อไม่ให้สถิติซ้ำซ้อนกันถ้าไม่ระบุ
        const targetType = type || AttendanceType.ASSEMBLY;

        // ดึงห้องเรียน
        const classrooms = await this.prisma.classroom.findMany({
            where: {
                // กรองตาม ID (ถ้ามี)
                id: classroomId ? Number(classroomId) : undefined,
                // ✅ กรองเจาะจงไปที่ตาราง term ที่เชื่อมกันอยู่
                term: {
                    isActive: true
                }
            },
            include: {
                _count: { select: { students: true } },
            },
            orderBy: { name: 'asc' },
        });

        // ดึงการเช็คชื่อตามช่วงเวลาและประเภท
        const attendances = await this.prisma.attendanceRecord.findMany({
            where: {
                date: { gte: startOfDay, lte: endOfDay },
                type: targetType,
                student: {
                    classroomId: classroomId ? Number(classroomId) : undefined,
                },
            },
            include: {
                student: { select: { classroomId: true } },
            },
        });

        // คำนวณสรุปผล
        const summary = classrooms.map((room) => {
            const roomAttendances = attendances.filter((a) => a.student.classroomId === room.id);
            const totalStudents = room._count.students;

            const presentCount = roomAttendances.filter((a) => a.status === AttendanceStatus.PRESENT).length;
            const absentCount = roomAttendances.filter((a) => a.status === AttendanceStatus.ABSENT).length;
            const lateCount = roomAttendances.filter((a) => a.status === AttendanceStatus.LATE).length;
            const leaveCount = roomAttendances.filter((a) => a.status === AttendanceStatus.LEAVE).length;

            const totalChecked = presentCount + absentCount + lateCount + leaveCount;
            const notCheckedCount = totalStudents - totalChecked;

            const calcPercent = (count: number) => {
                if (totalStudents === 0) return 0;
                return Number(((count / totalStudents) * 100).toFixed(2));
            };

            return {
                classroomId: room.id,
                classroomName: room.name,
                statistics: {
                    totalStudents,
                    totalChecked,
                    notChecked: notCheckedCount,
                    present: presentCount,
                    absent: absentCount,
                    late: lateCount,
                    leave: leaveCount,
                },
                percentages: {
                    present: calcPercent(presentCount),
                    absent: calcPercent(absentCount),
                    late: calcPercent(lateCount),
                    leave: calcPercent(leaveCount),
                    notChecked: calcPercent(notCheckedCount),
                },
            };
        });
 
        return {
            date: targetDate.format('YYYY-MM-DD'),
            type: targetType,
            isSchoolDay: true,
            reason: null,
            summary,
        };
    }

    async recordBulk(recorderId: string, dto: CreateBulkAttendanceDto) {
        const todayThai = dayjs().tz(this.TIMEZONE);
        const { activeTerm, schoolDayStatus } =
            await this.getActiveTermSchoolDayStatus(todayThai);

        if (!schoolDayStatus.isSchoolDay) {
            throw new BadRequestException(
                `ไม่สามารถเช็คชื่อได้ เนื่องจากวันนี้ไม่ใช่วันเรียน (${schoolDayStatus.reason})`,
            );
        }

        // คำนวณเวลาเริ่มต้นและสิ้นสุดของ "วันนี้" ในโซนเวลาประเทศไทย
        const startOfDay = todayThai.startOf('day').toDate();
        const endOfDay = todayThai.endOf('day').toDate();

        // 1. ดึงข้อมูลว่า "วันนี้" มีใครถูกเช็คชื่อใน "ประเภทนี้" ไปแล้วบ้าง
        const existingRecords = await this.prisma.attendanceRecord.findMany({
            where: {
                type: dto.type,
                date: { gte: startOfDay, lte: endOfDay },
                studentId: { in: dto.records.map(r => r.studentId) },
            },
            select: { studentId: true }
        });

        // 2. กรองเอาเฉพาะคนที่ "ยังไม่ได้ถูกเช็คชื่อ" 
        const existingStudentIds = existingRecords.map(r => r.studentId);
        const newRecords = dto.records.filter(r => !existingStudentIds.includes(r.studentId));

        if (newRecords.length === 0) {
            throw new BadRequestException(`นักเรียนทั้งหมดในรายการนี้ ถูกเช็คชื่อประเภท ${dto.type} ของวันนี้ไปแล้ว`);
        }

        // ดึงข้อมูลนักเรียนชุดนี้มาล่วงหน้าเพื่อเอา lineUserId และชื่อไปส่ง LINE
        const studentsToNotify = await this.prisma.user.findMany({
            where: { id: { in: newRecords.map(r => r.studentId) } },
            select: { id: true, firstName: true, lastName: true, lineUserId: true }
        });

        const [lateCategory, absentCategory] = await Promise.all([
            this.prisma.pointCategory.findUnique({ where: { id: this.LATE_CATEGORY_ID } }),
            this.prisma.pointCategory.findUnique({ where: { id: this.ABSENT_CATEGORY_ID } }),
        ]);

        return this.prisma.$transaction(async (tx) => {
            // 3. บันทึกการเช็คชื่อ (เฉพาะคนที่ผ่านการกรองแล้ว)
            const attendanceData = newRecords.map((r) => ({
                type: dto.type,
                status: r.status,
                studentId: r.studentId,
                recorderId: recorderId,
                termId: activeTerm.id,
            }));
            const createdAttendances = await tx.attendanceRecord.createMany({ data: attendanceData });

            // 4. หักคะแนน
            const behaviorData: any[] = [];
            const notePrefix = `ระบบหักคะแนนอัตโนมัติจากการเช็คชื่อ: ${dto.type === AttendanceType.ASSEMBLY ? 'เข้าแถว' : 'เขตพื้นที่'}`;

            for (const record of newRecords) {
                if (record.status === AttendanceStatus.LATE && lateCategory) {
                    behaviorData.push({
                        points: lateCategory.defaultPoints,
                        categoryId: this.LATE_CATEGORY_ID,
                        studentId: record.studentId,
                        recorderId: recorderId,
                        note: notePrefix,
                    });
                } else if (record.status === AttendanceStatus.ABSENT && absentCategory) {
                    behaviorData.push({
                        points: absentCategory.defaultPoints,
                        categoryId: this.ABSENT_CATEGORY_ID,
                        studentId: record.studentId,
                        recorderId: recorderId,
                        note: notePrefix,
                    });
                }
            }

            if (behaviorData.length > 0) {
                await tx.behaviorRecord.createMany({ data: behaviorData });
            }

            // 5. ส่ง LINE แจ้งเตือน (ลูปเฉพาะเด็กที่ต้องถูกหักคะแนน)
            for (const record of newRecords) {
                const student = studentsToNotify.find(s => s.id === record.studentId);

                if (student && student.lineUserId) {
                    if (record.status === AttendanceStatus.LATE) {
                        const msg = `🔔 [แจ้งเตือน] ${student.firstName} ${student.lastName} มีสถานะ "มาสาย" ในการเช็คชื่อประเภท ${dto.type === AttendanceType.ASSEMBLY ? 'เข้าแถว' : 'เขตพื้นที่'} ประจำวันที่ ${todayThai.format('DD/MM/YYYY')} และถูกหักคะแนนพฤติกรรมอัตโนมัติครับ`;
                        this.lineService.sendPushMessage(student.lineUserId, msg);
                    } else if (record.status === AttendanceStatus.ABSENT) {
                        const msg = `🔔 [แจ้งเตือน] ${student.firstName} ${student.lastName} มีสถานะ "ขาด" ในการเช็คชื่อประเภท ${dto.type === AttendanceType.ASSEMBLY ? 'เข้าแถว' : 'เขตพื้นที่'} ประจำวันที่ ${todayThai.format('DD/MM/YYYY')} ครับ`;
                        this.lineService.sendPushMessage(student.lineUserId, msg);
                    }
                }
            }

            return {
                message: `บันทึกสำเร็จ ${createdAttendances.count} รายการ (ข้ามรายชื่อที่ซ้ำ ${dto.records.length - newRecords.length} รายการ)`,
                autoDeducted: behaviorData.length,
            };
        });
    }

    async updateAttendance(id: string, updaterId: string, dto: UpdateAttendanceDto) {
        const existingRecord = await this.prisma.attendanceRecord.findUnique({ where: { id } });
        if (!existingRecord) throw new NotFoundException('ไม่พบข้อมูล');
        if (existingRecord.status === dto.status) return existingRecord;

        const [lateCategory, absentCategory] = await Promise.all([
            this.prisma.pointCategory.findUnique({ where: { id: this.LATE_CATEGORY_ID } }),
            this.prisma.pointCategory.findUnique({ where: { id: this.ABSENT_CATEGORY_ID } }),
        ]);

        return this.prisma.$transaction(async (tx) => {
            // ใช้ dayjs กำหนดขอบเขตของ "วันนั้น" ตามโซนเวลาไทย เพื่อลบคะแนนได้แม่นยำ
            const recordDate = dayjs(existingRecord.date).tz(this.TIMEZONE);
            const startOfDay = recordDate.startOf('day').toDate();
            const endOfDay = recordDate.endOf('day').toDate();

            const noteRef = `ระบบหักคะแนนอัตโนมัติจากการเช็คชื่อ: ${existingRecord.type}`;

            if (existingRecord.status === AttendanceStatus.LATE || existingRecord.status === AttendanceStatus.ABSENT) {
                await tx.behaviorRecord.deleteMany({
                    where: {
                        studentId: existingRecord.studentId,
                        note: noteRef,
                        createdAt: { gte: startOfDay, lte: endOfDay },
                    },
                });
            }

            if (dto.status === AttendanceStatus.LATE && lateCategory) {
                await tx.behaviorRecord.create({
                    data: {
                        points: lateCategory.defaultPoints,
                        categoryId: this.LATE_CATEGORY_ID,
                        studentId: existingRecord.studentId,
                        recorderId: updaterId,
                        note: noteRef,
                    },
                });
            } else if (dto.status === AttendanceStatus.ABSENT && absentCategory) {
                await tx.behaviorRecord.create({
                    data: {
                        points: absentCategory.defaultPoints,
                        categoryId: this.ABSENT_CATEGORY_ID,
                        studentId: existingRecord.studentId,
                        recorderId: updaterId,
                        note: noteRef,
                    },
                });
            }

            return tx.attendanceRecord.update({
                where: { id },
                data: { status: dto.status, recorderId: updaterId },
            });
        });
    }

    async getStudentAttendance(studentId: string) {
        // เวลาดึงข้อมูลส่งกลับให้หน้าบ้าน เราสามารถแปลงเป็นเวลาไทยตรงนี้ได้
        const records = await this.prisma.attendanceRecord.findMany({
            where: { studentId },
            orderBy: { date: 'desc' },
            include: { recorder: { select: { firstName: true, lastName: true } } },
        });

        // แนบ field 'localDate' ที่เป็นเวลาไทยไปให้หน้าบ้านใช้ง่ายๆ ครับ
        return records.map(record => ({
            ...record,
            localDate: dayjs(record.date).tz(this.TIMEZONE).format('YYYY-MM-DD HH:mm:ss')
        }));
    }


    // ดึงรายงานห้องที่ยังไม่ได้เช็คชื่อประจำวัน (เข้าแถว / เขตพื้นที่)
    async getMissingAttendanceClassrooms(dateString?: string) {
        // 1. ตั้งค่าวันที่ต้องการค้นหา (ถ้าไม่ระบุ จะดึงของ "วันนี้" โซนเวลาไทย)
        const targetDate = dateString ? dayjs(dateString).tz(this.TIMEZONE) : dayjs().tz(this.TIMEZONE);
        const { schoolDayStatus } =
            await this.getActiveTermSchoolDayStatus(targetDate);

        if (!schoolDayStatus.isSchoolDay) {
            return {
                targetDate: targetDate.format('YYYY-MM-DD'),
                isSchoolDay: false,
                reason: schoolDayStatus.reason,
                summary: {
                    totalClassrooms: 0,
                    missingAssembly: 0,
                    missingArea: 0,
                },
                details: [],
            };
        }

        const startOfDay = targetDate.startOf('day').toDate();
        const endOfDay = targetDate.endOf('day').toDate();

        // 2. ดึงข้อมูลห้องเรียนทั้งหมด พร้อมดึงเฉพาะ ID ของนักเรียนและชื่อครูที่ปรึกษา
        const classrooms = await this.prisma.classroom.findMany({
            where: {
                term: { isActive: true } // แนะนำให้กรองเฉพาะเทอมปัจจุบันด้วยครับ
            },
            include: {
                advisors: { select: { firstName: true, lastName: true, lineUserId: true } },
                students: {
                    where: { role: 'STUDENT' },
                    select: { id: true }, // ดึงแค่ ID มาก็พอเพื่อความรวดเร็ว
                },
            },
            orderBy: { name: 'asc' }, // เรียงตามชื่อห้อง (เช่น ม.1/1 ไป ม.6/5)
        });

        // 3. ดึงประวัติการเช็คชื่อ "ทั้งหมดของวันนี้" 
        const todayRecords = await this.prisma.attendanceRecord.findMany({
            where: {
                date: { gte: startOfDay, lte: endOfDay },
            },
            select: { studentId: true, type: true },
        });

        // 4. แยกข้อมูลลง Set เพื่อให้ระบบค้นหาได้เร็ว (O(1))
        const assemblyStudentIds = new Set(
            todayRecords.filter(r => r.type === 'ASSEMBLY').map(r => r.studentId)
        );
        const areaStudentIds = new Set(
            todayRecords.filter(r => r.type === 'AREA').map(r => r.studentId)
        );

        // 5. นำห้องเรียนมาเทียบกับข้อมูลการเช็คชื่อ
        const allDetails = classrooms.map(room => {
            const studentIds = room.students.map(s => s.id);
            const studentCount = studentIds.length;

            // ถ้าห้องนี้ยังไม่มีนักเรียนเลย ให้เซ็ตเป็น true เพื่อข้ามการแจ้งเตือน
            if (studentCount === 0) {
                return {
                    classroomId: room.id,
                    className: room.name,
                    advisorName: room.advisors.length > 0 ? `${room.advisors[0].firstName} ${room.advisors[0].lastName}` : 'ไม่มีที่ปรึกษา',
                    advisorLineId: room.advisors.length > 0 ? room.advisors[0].lineUserId : null,
                    studentCount: 0,
                    isAssemblyChecked: true,
                    isAreaChecked: true,
                };
            }

            // ตรรกะ: ถ้ามีเด็กในห้อง "อย่างน้อย 1 คน" ถูกเช็คชื่อไปแล้ว ถือว่าห้องนี้ทำรายการแล้ว
            const isAssemblyChecked = studentIds.some(id => assemblyStudentIds.has(id));
            const isAreaChecked = studentIds.some(id => areaStudentIds.has(id));

            return {
                classroomId: room.id,
                className: room.name,
                advisorName: room.advisors.length > 0 ? `${room.advisors[0].firstName} ${room.advisors[0].lastName}` : 'ไม่มีที่ปรึกษา',
                advisorLineId: room.advisors.length > 0 ? room.advisors[0].lineUserId : null,
                studentCount,
                isAssemblyChecked,
                isAreaChecked,
            };
        });

        // 6. สรุปตัวเลขสำหรับทำ Dashboard (นับจากห้องที่มีนักเรียนและยังเช็คไม่ครบ)
        const summary = {
            totalClassrooms: allDetails.filter(r => r.studentCount > 0).length,
            missingAssembly: allDetails.filter(r => !r.isAssemblyChecked && r.studentCount > 0).length,
            missingArea: allDetails.filter(r => !r.isAreaChecked && r.studentCount > 0).length,
        };

        // 7. กรองแสดงเฉพาะห้องที่ "ยังเช็คไม่ครบทั้ง 2 ประเภท"
        // (หมายถึง ขาดเข้าแถว หรือ ขาดเขตพื้นที่ อย่างใดอย่างหนึ่ง หรือขาดทั้งคู่)
        const missingOnlyDetails = allDetails.filter(r =>
            r.studentCount > 0 && (!r.isAssemblyChecked || !r.isAreaChecked)
        );

        /* * หมายเหตุ: หากต้องการให้แสดงเฉพาะคนที่ "ไม่ได้เช็คเลยทั้งคู่" (ขาดทั้ง 2 อย่างพร้อมกัน)
         * ให้เปลี่ยนเงื่อนไขในบรรทัดด้านบนเป็น: (!r.isAssemblyChecked && !r.isAreaChecked)
         */

        // 8. ส่งข้อมูลกลับไปให้ Frontend
        return {
            targetDate: targetDate.format('YYYY-MM-DD'),
            isSchoolDay: true,
            reason: null,
            summary,
            details: missingOnlyDetails,
        };
    }

    async sendLineNotification(dateStr?: string) {
        // 1. กำหนดวันที่เป้าหมาย (ถ้าไม่ส่งมา ให้ใช้วันปัจจุบัน)
        const targetDate = dateStr ? dayjs.tz(dateStr, 'Asia/Bangkok') : dayjs.tz('Asia/Bangkok');
        const { schoolDayStatus } =
            await this.getActiveTermSchoolDayStatus(targetDate);

        if (!schoolDayStatus.isSchoolDay) {
            return {
                success: true,
                skipped: true,
                reason: schoolDayStatus.reason,
                message: 'ข้ามการส่งแจ้งเตือน เนื่องจากไม่ใช่วันเรียน',
                count: 0,
            };
        }

        const startOfDay = targetDate.startOf('day').toDate();
        const endOfDay = targetDate.endOf('day').toDate();
        const formattedDate = targetDate.format('DD/MM/YYYY');

        // 2. ดึงห้องเรียนทั้งหมดที่อยู่ในเทอมปัจจุบัน พร้อมดึงข้อมูลครูที่ปรึกษาที่มี LINE ID
        const classrooms = await this.prisma.classroom.findMany({
            where: {
                term: { isActive: true }, // เอาเฉพาะเทอมที่เปิดใช้งาน
            },
            include: {
                advisors: {
                    where: {
                        lineUserId: { not: null }, // ดึงเฉพาะครูที่ผูก LINE แล้ว
                    },
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        lineUserId: true,
                    },
                },
            },
        });

        let sentCount = 0;
        const errors: string[] = [];

        // 3. วนลูปเช็คสถานะการเช็คชื่อทีละห้อง
        for (const room of classrooms) {
            // ถ้าห้องนี้ไม่มีครูที่ผูก LINE ไว้ ก็ข้ามไปเลย (ส่งไม่ถึงอยู่แล้ว)
            if (!room.advisors || room.advisors.length === 0) continue;

            // เช็คว่ามีบันทึก 'เข้าแถว' ของห้องนี้ในวันนี้หรือยัง
            const assemblyCheck = await this.prisma.attendanceRecord.findFirst({
                where: {
                    type: 'ASSEMBLY',
                    date: { gte: startOfDay, lte: endOfDay },
                    student: { classroomId: room.id },
                },
            });

            // เช็คว่ามีบันทึก 'เขตพื้นที่' ของห้องนี้ในวันนี้หรือยัง
            const areaCheck = await this.prisma.attendanceRecord.findFirst({
                where: {
                    type: 'AREA',
                    date: { gte: startOfDay, lte: endOfDay },
                    student: { classroomId: room.id },
                },
            });

            // ตรวจสอบว่าขาดเช็ครายการไหนบ้าง
            const missingTypes: string[] = [];
            if (!assemblyCheck) missingTypes.push('📌 เข้าแถวหน้าเสาธง');
            if (!areaCheck) missingTypes.push('🧹 เวรเขตพื้นที่');

            // 4. ถ้ามีรายการที่ยังไม่เช็ค ให้ส่งข้อความหาครูที่ปรึกษาห้องนั้น
            if (missingTypes.length > 0) {
                for (const advisor of room.advisors) {
                    try {
                        // สร้างข้อความแจ้งเตือนสวยๆ
                        const message = `🚨 แจ้งเตือนการเช็คชื่อ\n\nเรียน ครู${advisor.firstName}\nระบบพบว่าห้อง ${room.name} ยังไม่ได้บันทึกข้อมูลประจำวันที่ ${formattedDate} ในรายการต่อไปนี้:\n\n${missingTypes.join('\n')}\n\nรบกวนคุณครูดำเนินการด้วยครับ/ค่ะ 🙏`;

                        // 💡 เรียกใช้ LineService (เปลี่ยนชื่อเมธอด pushMessage ให้ตรงกับที่ท่านรองทำไว้)
                        if (advisor.lineUserId) {
                            await this.lineService.sendPushMessage(advisor.lineUserId, message);
                            sentCount++;
                        }
                    } catch (error: any) {
                        this.logger.error(`ไม่สามารถส่ง LINE ให้ครู ${advisor.firstName} ได้: ${error.message}`);
                        errors.push(`ครู${advisor.firstName}`);
                    }
                }
            }
        }

        // 5. ส่งผลลัพธ์กลับไปให้ Controller (เพื่อนำไปโชว์ใน SweetAlert ฝั่ง Frontend)
        return {
            success: true,
            message: 'ประมวลผลการส่งแจ้งเตือนเสร็จสิ้น',
            count: sentCount,
            failedTo: errors.length > 0 ? errors : undefined,
        };
    }
}
