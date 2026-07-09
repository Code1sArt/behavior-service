import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBulkAttendanceDto, ManualAttendanceDto, UpdateAttendanceDto } from './dto/create-attendance.dto';
import { AttendanceStatus, AttendanceType, Role } from '@prisma/client';
import { LineService } from '../line/line.service'; // <--- 1. นำเข้า 
import { AcademicCalendarService } from '../academic-calendar/academic-calendar.service';

// นำเข้า dayjs และปลั๊กอินจัดการ Timezone
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { calculateLegacyPointDelta } from '../points/score-calculator';
import {
    requireStudentAcademicContext,
    requireStudentAcademicContexts,
} from '../students/student-academic-context';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class AttendanceService {
    private readonly LATE_CATEGORY_ID = 2;
    private readonly ABSENT_CATEGORY_ID = 1;
    private readonly TIMEZONE = 'Asia/Bangkok'; // ตั้งค่าเป็นโซนเวลาไทย
    logger: any;

    constructor(
        private prisma: PrismaService,
        private lineService: LineService,
        private academicCalendarService: AcademicCalendarService,
    ) { }

    private attendanceBehaviorNote(type: AttendanceType) {
        const label =
            type === AttendanceType.ASSEMBLY ? 'เข้าแถว' : 'เขตพื้นที่';
        return `ระบบหักคะแนนอัตโนมัติจากการเช็คชื่อ: ${label}`;
    }

    private attendanceTypeLabel(type: AttendanceType) {
        return type === AttendanceType.ASSEMBLY ? 'เข้าแถว' : 'เขตพื้นที่';
    }

    private async notifyAttendanceStatus(
        student: {
            firstName: string;
            lastName: string;
            lineUserId: string | null;
            parent?: { lineUserId: string | null } | null;
        },
        status: AttendanceStatus,
        type: AttendanceType,
        date: dayjs.Dayjs,
    ) {
        if (status !== AttendanceStatus.LATE && status !== AttendanceStatus.ABSENT) {
            return;
        }

        const statusText = status === AttendanceStatus.LATE ? 'มาสาย' : 'ขาด';
        const behaviorText = ' และถูกหักคะแนนพฤติกรรมอัตโนมัติ';
        const message =
            `🔔 [แจ้งเตือนการเช็คชื่อ]\n` +
            `${student.firstName} ${student.lastName} มีสถานะ "${statusText}" ` +
            `ในการเช็คชื่อประเภท${this.attendanceTypeLabel(type)} ` +
            `ประจำวันที่ ${date.format('DD/MM/YYYY')}${behaviorText}ครับ`;

        const targets = [
            student.lineUserId,
            student.parent?.lineUserId,
        ].filter((lineUserId): lineUserId is string => Boolean(lineUserId));

        await Promise.all(
            [...new Set(targets)].map((lineUserId) =>
                this.lineService.sendPushMessage(lineUserId, message),
            ),
        );
    }

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

    private async getTermSchoolDayStatus(targetDate: dayjs.Dayjs) {
        const term = await this.prisma.academicTerm.findFirst({
            where: {
                startDate: { lte: targetDate.endOf('day').toDate() },
                endDate: { gte: targetDate.startOf('day').toDate() },
            },
        });

        if (!term) {
            return {
                term: null,
                schoolDayStatus: {
                    isSchoolDay: false,
                    reason: 'OUTSIDE_TERM',
                },
            };
        }

        const schoolDayStatus =
            await this.academicCalendarService.getSchoolDayStatus(
                term.id,
                targetDate,
            );
        return { term, schoolDayStatus };
    }

    // -------------------------------------------------------------
    // 1. ดึงประวัติการเช็คชื่อรายวัน (แยกตามห้อง และแบ่ง Type)
    // -------------------------------------------------------------
    async getDailyHistory(dateStr?: string, classroomId?: number, type?: AttendanceType) {
        // บังคับใช้โซนเวลาของไทย เพื่อแก้ปัญหาข้อมูลหายตอนรอยต่อเที่ยงคืน
        const targetDate = dateStr
            ? dayjs.tz(dateStr, 'YYYY-MM-DD', 'Asia/Bangkok')
            : dayjs().tz('Asia/Bangkok');

        const { term, schoolDayStatus } =
            await this.getTermSchoolDayStatus(targetDate);

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
                termId: term!.id,
                type: type ? type : undefined, // ถ้าส่ง type มาก็กรอง ถ้าไม่ส่งมาคือดึงทั้งหมด
                classroomId: classroomId ? Number(classroomId) : undefined,
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
                classroom: { select: { name: true } },
                recorder: {
                    select: { firstName: true, lastName: true },
                },
            },
            orderBy: [
                { classroom: { name: 'asc' } },
                { student: { firstName: 'asc' } },
            ],
        });
        const recordsWithSnapshotClassroom = records.map((record) => ({
            ...record,
            student: {
                ...record.student,
                classroom:
                    record.classroom ??
                    record.student.classroom ??
                    { name: 'ไม่ทราบห้อง' },
            },
        }));

        // จัดกลุ่มแยกประเภท (ASSEMBLY / AREA) ส่งกลับไปให้หน้าบ้านใช้ง่ายๆ
        return {
            date: targetDate.format('YYYY-MM-DD'),
            isSchoolDay: true,
            reason: null,
            records: {
                ASSEMBLY: recordsWithSnapshotClassroom.filter(r => r.type === AttendanceType.ASSEMBLY),
                AREA: recordsWithSnapshotClassroom.filter(r => r.type === AttendanceType.AREA),
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

        const { term, schoolDayStatus } =
            await this.getTermSchoolDayStatus(targetDate);

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
                termId: term!.id,
            },
            include: {
                enrollments: {
                    where: { termId: term!.id },
                    select: { studentId: true },
                },
                students: {
                    where: { role: 'STUDENT' },
                    select: { id: true },
                },
            },
            orderBy: { name: 'asc' },
        });

        // ดึงการเช็คชื่อตามช่วงเวลาและประเภท
        const attendances = await this.prisma.attendanceRecord.findMany({
            where: {
                date: { gte: startOfDay, lte: endOfDay },
                termId: term!.id,
                type: targetType,
                classroomId: classroomId ? Number(classroomId) : undefined,
            },
            select: {
                classroomId: true,
                status: true,
                student: { select: { classroomId: true } },
            },
        });

        // คำนวณสรุปผล
        const summary = classrooms.map((room) => {
            const roomAttendances = attendances.filter(
                (attendance) =>
                    (attendance.classroomId ?? attendance.student.classroomId) ===
                    room.id,
            );
            const rosterIds =
                room.enrollments.length > 0
                    ? room.enrollments.map((enrollment) => enrollment.studentId)
                    : room.students.map((student) => student.id);
            const totalStudents = new Set(rosterIds).size;

            const presentCount = roomAttendances.filter((a) => a.status === AttendanceStatus.PRESENT).length;
            const absentCount = roomAttendances.filter((a) => a.status === AttendanceStatus.ABSENT).length;
            const lateCount = roomAttendances.filter((a) => a.status === AttendanceStatus.LATE).length;
            const leaveCount = roomAttendances.filter((a) => a.status === AttendanceStatus.LEAVE).length;
            const activityCount = roomAttendances.filter((a) => a.status === AttendanceStatus.ACTIVITY).length;

            const totalChecked = presentCount + absentCount + lateCount + leaveCount + activityCount;
            const notCheckedCount = Math.max(0, totalStudents - totalChecked);

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
                    activity: activityCount,
                },
                percentages: {
                    present: calcPercent(presentCount),
                    absent: calcPercent(absentCount),
                    late: calcPercent(lateCount),
                    leave: calcPercent(leaveCount),
                    activity: calcPercent(activityCount),
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
        const studentContexts = await requireStudentAcademicContexts(
            this.prisma,
            newRecords.map((record) => record.studentId),
            activeTerm.id,
        );

        // ดึงข้อมูลนักเรียนชุดนี้มาล่วงหน้าเพื่อเอา lineUserId และชื่อไปส่ง LINE
        const studentsToNotify = await this.prisma.user.findMany({
            where: { id: { in: newRecords.map(r => r.studentId) } },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                lineUserId: true,
                parent: { select: { lineUserId: true } },
            }
        });

        const [lateCategory, absentCategory] = await Promise.all([
            this.prisma.pointCategory.findUnique({ where: { id: this.LATE_CATEGORY_ID } }),
            this.prisma.pointCategory.findUnique({ where: { id: this.ABSENT_CATEGORY_ID } }),
        ]);

        return this.prisma.$transaction(async (tx) => {
            // 3. บันทึกการเช็คชื่อ (เฉพาะคนที่ผ่านการกรองแล้ว)
            const attendanceData = newRecords.map((r) => {
                const context = studentContexts.get(r.studentId)!;
                return {
                    type: dto.type,
                    status: r.status,
                    studentId: r.studentId,
                    recorderId: recorderId,
                    termId: activeTerm.id,
                    classroomId: context.classroomId,
                };
            });
            const createdAttendances = await tx.attendanceRecord.createMany({ data: attendanceData });

            // 4. หักคะแนน
            const behaviorData: any[] = [];
            const notePrefix = this.attendanceBehaviorNote(dto.type);

            for (const record of newRecords) {
                const context = studentContexts.get(record.studentId)!;
                if (record.status === AttendanceStatus.LATE && lateCategory) {
                    behaviorData.push({
                        points: lateCategory.defaultPoints,
                        categoryId: this.LATE_CATEGORY_ID,
                        studentId: record.studentId,
                        recorderId: recorderId,
                        note: notePrefix,
                        pointDelta: calculateLegacyPointDelta({
                            points: lateCategory.defaultPoints,
                            category: lateCategory,
                        }),
                        classroomId: context.classroomId,
                        termId: activeTerm.id,
                    });
                } else if (record.status === AttendanceStatus.ABSENT && absentCategory) {
                    behaviorData.push({
                        points: absentCategory.defaultPoints,
                        categoryId: this.ABSENT_CATEGORY_ID,
                        studentId: record.studentId,
                        recorderId: recorderId,
                        note: notePrefix,
                        pointDelta: calculateLegacyPointDelta({
                            points: absentCategory.defaultPoints,
                            category: absentCategory,
                        }),
                        classroomId: context.classroomId,
                        termId: activeTerm.id,
                    });
                }
            }

            if (behaviorData.length > 0) {
                await tx.behaviorRecord.createMany({ data: behaviorData });
            }

            // 5. ส่ง LINE แจ้งเตือน (ลูปเฉพาะเด็กที่ต้องถูกหักคะแนน)
            for (const record of newRecords) {
                const student = studentsToNotify.find(s => s.id === record.studentId);

                if (student) {
                    void this.notifyAttendanceStatus(
                        student,
                        record.status,
                        dto.type,
                        todayThai,
                    );
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
        if (existingRecord.recorderId !== updaterId) {
            throw new ForbiddenException('แก้ไขได้เฉพาะครูผู้เช็คชื่อรายการนี้เท่านั้น');
        }
        if (existingRecord.status === dto.status) return existingRecord;
        const context = existingRecord.classroomId
            ? null
            : await requireStudentAcademicContext(
                this.prisma,
                existingRecord.studentId,
                existingRecord.termId,
            );
        const classroomId =
            existingRecord.classroomId ?? context!.classroomId;

        const [lateCategory, absentCategory] = await Promise.all([
            this.prisma.pointCategory.findUnique({ where: { id: this.LATE_CATEGORY_ID } }),
            this.prisma.pointCategory.findUnique({ where: { id: this.ABSENT_CATEGORY_ID } }),
        ]);

        const updatedRecord = await this.prisma.$transaction(async (tx) => {
            // ใช้ dayjs กำหนดขอบเขตของ "วันนั้น" ตามโซนเวลาไทย เพื่อลบคะแนนได้แม่นยำ
            const recordDate = dayjs(existingRecord.date).tz(this.TIMEZONE);
            const startOfDay = recordDate.startOf('day').toDate();
            const endOfDay = recordDate.endOf('day').toDate();

            const noteRef = this.attendanceBehaviorNote(existingRecord.type);
            const legacyNoteRef = `ระบบหักคะแนนอัตโนมัติจากการเช็คชื่อ: ${existingRecord.type}`;

            if (existingRecord.status === AttendanceStatus.LATE || existingRecord.status === AttendanceStatus.ABSENT) {
                await tx.behaviorRecord.deleteMany({
                    where: {
                        studentId: existingRecord.studentId,
                        note: { in: [noteRef, legacyNoteRef] },
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
                        pointDelta: calculateLegacyPointDelta({
                            points: lateCategory.defaultPoints,
                            category: lateCategory,
                        }),
                        classroomId,
                        termId: existingRecord.termId,
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
                        pointDelta: calculateLegacyPointDelta({
                            points: absentCategory.defaultPoints,
                            category: absentCategory,
                        }),
                        classroomId,
                        termId: existingRecord.termId,
                    },
                });
            }

            return tx.attendanceRecord.update({
                where: { id },
                data: {
                    status: dto.status,
                    recorderId: updaterId,
                    classroomId,
                },
            });
        });

        const student = await this.prisma.user.findUnique({
            where: { id: existingRecord.studentId },
            select: {
                firstName: true,
                lastName: true,
                lineUserId: true,
                parent: { select: { lineUserId: true } },
            },
        });

        if (student) {
            void this.notifyAttendanceStatus(
                student,
                dto.status,
                existingRecord.type,
                dayjs(existingRecord.date).tz(this.TIMEZONE),
            );
        }

        return updatedRecord;
    }

    async upsertManualAttendance(updaterId: string, dto: ManualAttendanceDto) {
        const targetDate = dayjs.tz(dto.date, 'YYYY-MM-DD', this.TIMEZONE);
        const { term, schoolDayStatus } = await this.getTermSchoolDayStatus(targetDate);

        if (!term) {
            throw new BadRequestException('วันที่ที่เลือกไม่อยู่ในภาคเรียนใด');
        }
        if (!schoolDayStatus.isSchoolDay) {
            throw new BadRequestException(
                `ไม่สามารถแก้ไขการเช็คชื่อได้ เนื่องจากวันที่เลือกไม่ใช่วันเรียน (${schoolDayStatus.reason})`,
            );
        }

        const context = await requireStudentAcademicContext(
            this.prisma,
            dto.studentId,
            term.id,
        );
        const startOfDay = targetDate.startOf('day').toDate();
        const endOfDay = targetDate.endOf('day').toDate();
        const recordDate = targetDate.hour(8).minute(0).second(0).millisecond(0).toDate();

        const existingRecord = await this.prisma.attendanceRecord.findFirst({
            where: {
                studentId: dto.studentId,
                type: dto.type,
                termId: term.id,
                date: { gte: startOfDay, lte: endOfDay },
            },
        });

        const [lateCategory, absentCategory] = await Promise.all([
            this.prisma.pointCategory.findUnique({ where: { id: this.LATE_CATEGORY_ID } }),
            this.prisma.pointCategory.findUnique({ where: { id: this.ABSENT_CATEGORY_ID } }),
        ]);

        const noteRef = this.attendanceBehaviorNote(dto.type);
        const legacyNoteRef = `ระบบหักคะแนนอัตโนมัติจากการเช็คชื่อ: ${dto.type}`;

        const savedRecord = await this.prisma.$transaction(async (tx) => {
            if (existingRecord?.status === AttendanceStatus.LATE || existingRecord?.status === AttendanceStatus.ABSENT) {
                await tx.behaviorRecord.deleteMany({
                    where: {
                        studentId: dto.studentId,
                        note: { in: [noteRef, legacyNoteRef] },
                        createdAt: { gte: startOfDay, lte: endOfDay },
                    },
                });
            }

            if (dto.status === AttendanceStatus.LATE && lateCategory) {
                await tx.behaviorRecord.create({
                    data: {
                        points: lateCategory.defaultPoints,
                        categoryId: this.LATE_CATEGORY_ID,
                        studentId: dto.studentId,
                        recorderId: updaterId,
                        note: noteRef,
                        createdAt: recordDate,
                        pointDelta: calculateLegacyPointDelta({
                            points: lateCategory.defaultPoints,
                            category: lateCategory,
                        }),
                        classroomId: context.classroomId,
                        termId: term.id,
                    },
                });
            } else if (dto.status === AttendanceStatus.ABSENT && absentCategory) {
                await tx.behaviorRecord.create({
                    data: {
                        points: absentCategory.defaultPoints,
                        categoryId: this.ABSENT_CATEGORY_ID,
                        studentId: dto.studentId,
                        recorderId: updaterId,
                        note: noteRef,
                        createdAt: recordDate,
                        pointDelta: calculateLegacyPointDelta({
                            points: absentCategory.defaultPoints,
                            category: absentCategory,
                        }),
                        classroomId: context.classroomId,
                        termId: term.id,
                    },
                });
            }

            if (existingRecord) {
                return tx.attendanceRecord.update({
                    where: { id: existingRecord.id },
                    data: {
                        status: dto.status,
                        recorderId: updaterId,
                        classroomId: context.classroomId,
                    },
                });
            }

            return tx.attendanceRecord.create({
                data: {
                    type: dto.type,
                    status: dto.status,
                    date: recordDate,
                    studentId: dto.studentId,
                    recorderId: updaterId,
                    termId: term.id,
                    classroomId: context.classroomId,
                },
            });
        });

        const student = await this.prisma.user.findUnique({
            where: { id: dto.studentId },
            select: {
                firstName: true,
                lastName: true,
                lineUserId: true,
                parent: { select: { lineUserId: true } },
            },
        });

        if (student) {
            void this.notifyAttendanceStatus(
                student,
                dto.status,
                dto.type,
                targetDate,
            );
        }

        return savedRecord;
    }

    async getStudentAttendance(studentId: string, requesterId: string, requesterRole: Role) {
        if (requesterRole === Role.STUDENT && requesterId !== studentId) {
            throw new ForbiddenException('นักเรียนดูประวัติการเช็คชื่อได้เฉพาะของตนเอง');
        }

        if (requesterRole === Role.TEACHER) {
            const advisedStudent = await this.prisma.user.findFirst({
                where: {
                    id: studentId,
                    role: Role.STUDENT,
                    classroom: {
                        advisors: { some: { id: requesterId } },
                    },
                },
                select: { id: true },
            });
            if (!advisedStudent) {
                throw new ForbiddenException('ครูดูประวัติได้เฉพาะนักเรียนในห้องที่ปรึกษา');
            }
        }

        if (requesterRole === Role.PARENT) {
            const child = await this.prisma.user.findFirst({
                where: {
                    id: studentId,
                    role: Role.STUDENT,
                    parentId: requesterId,
                },
                select: { id: true },
            });
            if (!child) {
                throw new ForbiddenException('ผู้ปกครองดูประวัติได้เฉพาะนักเรียนในความดูแล');
            }
        }

        // เวลาดึงข้อมูลส่งกลับให้หน้าบ้าน เราสามารถแปลงเป็นเวลาไทยตรงนี้ได้
        const records = await this.prisma.attendanceRecord.findMany({
            where: { studentId },
            orderBy: { date: 'desc' },
            include: {
                classroom: { select: { id: true, name: true } },
                term: { select: { id: true, term: true, year: true } },
                recorder: { select: { firstName: true, lastName: true } },
            },
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
        const { term, schoolDayStatus } =
            await this.getTermSchoolDayStatus(targetDate);

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
            where: { termId: term!.id },
            include: {
                advisors: { select: { firstName: true, lastName: true, lineUserId: true } },
                enrollments: {
                    where: { termId: term!.id },
                    select: { studentId: true },
                },
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
                termId: term!.id,
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
            const studentIds =
                room.enrollments.length > 0
                    ? room.enrollments.map(enrollment => enrollment.studentId)
                    : room.students.map(student => student.id);
            const studentCount = studentIds.length;
            const advisorName = room.advisors.length > 0
                ? room.advisors.map(advisor => advisor.firstName).join(', ')
                : 'ไม่มีที่ปรึกษา';

            // ถ้าห้องนี้ยังไม่มีนักเรียนเลย ให้เซ็ตเป็น true เพื่อข้ามการแจ้งเตือน
            if (studentCount === 0) {
                return {
                    classroomId: room.id,
                    className: room.name,
                    advisorName,
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
                advisorName,
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
        const { term, schoolDayStatus } =
            await this.getTermSchoolDayStatus(targetDate);

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
            where: { termId: term!.id },
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
                    termId: term!.id,
                    classroomId: room.id,
                },
            });

            // เช็คว่ามีบันทึก 'เขตพื้นที่' ของห้องนี้ในวันนี้หรือยัง
            const areaCheck = await this.prisma.attendanceRecord.findFirst({
                where: {
                    type: 'AREA',
                    date: { gte: startOfDay, lte: endOfDay },
                    termId: term!.id,
                    classroomId: room.id,
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
