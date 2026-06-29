import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PointType, Prisma } from '@prisma/client';
import { log } from 'console';

@Injectable()
export class SummaryService {
    constructor(private prisma: PrismaService) { }

    // ฟังก์ชันช่วยคำนวณคะแนนสุทธิ
    private calculateNetScore(startingPoints: number, records: any[]) {
        console.log("ssss", records);
        
        return records.reduce((acc, record) => {
            // ตรวจสอบว่าหมวดหมู่เป็นแบบเพิ่มหรือหักคะแนน
            if (record.category?.type === PointType.ADD) {
                console.log("asas");
                return acc + record.points;
            } else {
                console.log("ssss");
                return acc - record.points;
            }
        }, startingPoints);
    }

    // ฟังก์ชันช่วยตัดสินสถานะตามเกณฑ์ของห้องเรียนนั้นๆ
    private determineStatus(score: number, classroom: any) {
        if (score < classroom.startingPoints) return 'FAILED';
        if (score >= classroom.shieldThreshold) return 'SHIELD';
        if (score >= classroom.certificateThreshold) return 'CERTIFICATE';
        return 'NORMAL';
    }

    // 1. สรุปรายบุคคล (ดึงเกณฑ์จากห้องที่นักเรียนสังกัด)
    async getStudentSummary(studentId: string) {
        const student = await this.prisma.user.findUnique({
            where: { id: studentId },
            include: {
                classroom: true,
                behaviorLogs: { include: { category: true } },
            },
        });

        if (!student || !student.classroom) {
            throw new NotFoundException('ไม่พบข้อมูลนักเรียนหรือข้อมูลห้องเรียน');
        }

        // console.log(student);
        

        const currentScore = this.calculateNetScore(
            student.classroom.startingPoints,
            student.behaviorLogs
        );

        return {
            studentId: student.id,
            name: `${student.firstName} ${student.lastName}`,
            scoreInfo: {
                currentScore,
                startingPoints: student.classroom.startingPoints,
                status: this.determineStatus(currentScore, student.classroom),
            },
            thresholds: {
                failing: student.classroom.failingThreshold,
                certificate: student.classroom.certificateThreshold,
                shield: student.classroom.shieldThreshold,
            },
            history: student.behaviorLogs,
        };
    }

    // 2. สรุปรายห้อง (ใช้เกณฑ์ของห้องนั้นจัดการนักเรียนทุกคน)
    async getClassroomSummary(classroomId: number) {

        const classroom = await this.prisma.classroom.findUnique({
            where: { id: classroomId },
            include: {
                students: {
                    where: { role: 'STUDENT' },
                    include: { behaviorLogs: { include: { category: true } } },
                },
            },
        });

        if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');

        const studentStats = classroom.students.map((student) => {
            const score = this.calculateNetScore(classroom.startingPoints, student.behaviorLogs);
            return {
                id: student.id,
                name: `${student.firstName} ${student.lastName}`,
                score,
                status: this.determineStatus(score, classroom),
            };
        });

        return {
            className: classroom.name,
            thresholds: {
                starting: classroom.startingPoints,
                failing: classroom.failingThreshold,
                certificate: classroom.certificateThreshold,
                shield: classroom.shieldThreshold,
            },
            summary: {
                total: studentStats.length,
                passed: studentStats.filter(s => s.status !== 'FAILED').length,
                failed: studentStats.filter(s => s.status === 'FAILED').length,
                shield: studentStats.filter(s => s.status === 'SHIELD').length,
                certificate: studentStats.filter(s => s.status === 'CERTIFICATE').length,
            },
            students: studentStats,
        };
    }


    // 3. สรุปภาพรวมทั้งโรงเรียน (แยกกลุ่มตามเกณฑ์)
    async getSchoolWideSummary() {
        // ดึงข้อมูลห้องเรียนทั้งหมด พร้อมนักเรียนและประวัติคะแนน
        const classrooms = await this.prisma.classroom.findMany({
            include: {
                students: {
                    where: { role: 'STUDENT' },
                    include: { behaviorLogs: { include: { category: true } } },
                },
            },
        });

        // เตรียมกล่องสำหรับนับจำนวน และเก็บรายชื่อ
        const summary = {
            total: 0,
            failedCount: 0,
            normalCount: 0,
            certificateCount: 0,
            shieldCount: 0,
        };

        const categorizedStudents = {
            failed: [] as any[],
            normal: [] as any[],
            certificate: [] as any[],
            shield: [] as any[],
        };

        // วนลูปคำนวณและแยกกลุ่มนักเรียน
        for (const classroom of classrooms) {
            for (const student of classroom.students) {
                const score = this.calculateNetScore(classroom.startingPoints, student.behaviorLogs);
                const status = this.determineStatus(score, classroom);

                summary.total++;

                // แพ็คข้อมูลนักเรียนเตรียมใส่กล่อง
                const studentData = {
                    id: student.id,
                    citizenId: student.citizenId,
                    name: `${student.firstName} ${student.lastName}`,
                    classroom: classroom.name,
                    score,
                };

                // จับแยกใส่กล่องตามสถานะ
                if (status === 'FAILED') {
                    summary.failedCount++;
                    categorizedStudents.failed.push(studentData);
                } else if (status === 'SHIELD') {
                    summary.shieldCount++;
                    categorizedStudents.shield.push(studentData);
                } else if (status === 'CERTIFICATE') {
                    summary.certificateCount++;
                    categorizedStudents.certificate.push(studentData);
                } else {
                    summary.normalCount++;
                    categorizedStudents.normal.push(studentData);
                }
            }
        }

        // เรียงลำดับคะแนนในแต่ละกลุ่ม (จากมากไปน้อย, ยกเว้น FAILED เรียงน้อยไปมากจะได้เห็นคนอาการหนักสุดก่อน)
        categorizedStudents.shield.sort((a, b) => b.score - a.score);
        categorizedStudents.certificate.sort((a, b) => b.score - a.score);
        categorizedStudents.normal.sort((a, b) => b.score - a.score);
        categorizedStudents.failed.sort((a, b) => a.score - b.score);

        return {
            summary,
            lists: categorizedStudents,
        };
    }
}