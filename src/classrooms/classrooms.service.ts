import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentExitReason, EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';

@Injectable()
export class ClassroomsService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreateClassroomDto) {
        let targetTermId = dto.termId;

        // 1. หาเทอมเป้าหมาย
        if (!targetTermId) {
            const activeTerm = await this.prisma.academicTerm.findFirst({
                where: { isActive: true },
            });
            if (!activeTerm) {
                throw new BadRequestException('ยังไม่ได้ตั้งค่าภาคเรียนปัจจุบัน');
            }
            targetTermId = activeTerm.id;
        }

        // --- 2. จุดที่เพิ่มใหม่: เช็คห้องซ้ำ ---
        const existingClassroom = await this.prisma.classroom.findFirst({
            where: {
                name: dto.name,
                termId: targetTermId,
            },
        });

        // ถ้าเจอว่ามีห้องชื่อนี้ ในเทอมเป้าหมายนี้อยู่แล้ว ให้เตะออกทันที
        if (existingClassroom) {
            throw new ConflictException(`ไม่สามารถสร้างได้ เนื่องจากมีห้องเรียน "${dto.name}" ในภาคเรียนนี้อยู่แล้ว`);
        }
        // ------------------------------------

        // 3. เตรียมข้อมูลครูที่ปรึกษา (ถ้ามี)
        const advisorConnections = dto.advisorIds
            ? dto.advisorIds.map(id => ({ id }))
            : [];

        // 4. บันทึกลง Database
        return this.prisma.classroom.create({
            data: {
                name: dto.name,
                startingPoints: dto.startingPoints ?? 100,
                failingThreshold: dto.failingThreshold,
                certificateThreshold: dto.certificateThreshold,
                shieldThreshold: dto.shieldThreshold,
                termId: targetTermId,
                advisors: {
                    connect: advisorConnections,
                },
            },
        });
    }

    async findAll() {
        const classrooms = await this.prisma.classroom.findMany({
            include: {
                advisors: {
                    select: { id: true, firstName: true, lastName: true },
                },
                term: { select: { id: true, term: true, year: true } },
                _count: {
                    select: {
                        enrollments: {
                            where: {
                                OR: [
                                    { status: EnrollmentStatus.ACTIVE },
                                    {
                                        status: EnrollmentStatus.ENDED,
                                        exitReason: {
                                            notIn: [
                                                EnrollmentExitReason.TRANSFERRED,
                                                EnrollmentExitReason.STUDY_LEAVE,
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });

        return classrooms.map(({ _count, ...classroom }) => ({
            ...classroom,
            _count: { students: _count.enrollments },
        }));
    }

    async findOne(id: number) {
        const classroom = await this.prisma.classroom.findUnique({
            where: { id },
            include: {
                advisors: {
                    select: { id: true, firstName: true, lastName: true },
                },
                students: { select: { id: true, citizenId: true, firstName: true, lastName: true } },
                term: { select: { id: true, term: true, year: true } },
            },
        });

        if (!classroom) {
            throw new NotFoundException(`ไม่พบข้อมูลห้องเรียน ID: ${id}`);
        }
        return classroom;
    }

    async update(id: number, dto: UpdateClassroomDto) { // ใช้ UpdateClassroomDto ของคุณ
        const existingRoom = await this.prisma.classroom.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        students: true,
                        enrollments: true,
                        attendanceRecords: true,
                        behaviorRecords: true,
                    },
                },
            },
        });
        if (!existingRoom) {
            throw new NotFoundException(`ไม่พบข้อมูลห้องเรียน ID: ${id}`);
        }

        const hasHistoricalRecords =
            existingRoom._count.enrollments > 0 ||
            existingRoom._count.attendanceRecords > 0 ||
            existingRoom._count.behaviorRecords > 0;
        const isChangingName =
            dto.name !== undefined && dto.name !== existingRoom.name;
        const isChangingTerm =
            dto.termId !== undefined && dto.termId !== existingRoom.termId;

        if (hasHistoricalRecords && (isChangingName || isChangingTerm)) {
            throw new BadRequestException(
                'ไม่สามารถเปลี่ยนชื่อหรือภาคเรียนของห้องที่มีประวัติแล้ว กรุณาสร้างห้องใหม่สำหรับภาคเรียนใหม่',
            );
        }
        if (existingRoom._count.students > 0 && isChangingTerm) {
            throw new BadRequestException(
                'ไม่สามารถย้ายภาคเรียนของห้องที่มีนักเรียนอยู่ กรุณาใช้ระบบเปลี่ยนภาคเรียน',
            );
        }

        // 1. ตรวจสอบก่อนว่ามีการเปลี่ยนชื่อห้องหรือเทอมไหม (ป้องกันชื่อซ้ำ)
        if (dto.name || dto.termId) {
            const checkName = dto.name || existingRoom.name;
            const checkTerm = dto.termId || existingRoom.termId;

            const duplicate = await this.prisma.classroom.findFirst({
                where: {
                    name: checkName,
                    termId: checkTerm,
                    id: { not: id } // หาห้องอื่นที่ชื่อซ้ำ แต่ไม่ใช่ห้องตัวมันเอง
                }
            });

            if (duplicate) {
                throw new ConflictException(`มีห้องเรียนชื่อ "${checkName}" ในภาคเรียนนี้อยู่แล้ว`);
            }
        }

        // 2. เตรียมก้อนข้อมูลสำหรับ Update
        const updateData: any = {
            name: dto.name,
            startingPoints: dto.startingPoints,
            failingThreshold: dto.failingThreshold,
            certificateThreshold: dto.certificateThreshold,
            shieldThreshold: dto.shieldThreshold,
            termId: dto.termId,
        };

        // 3. ✨ ไฮไลท์การแก้ปัญหา: ถ้ามีการส่ง advisorIds มา ให้ใช้คำสั่ง 'set'
        if (dto.advisorIds !== undefined) {
            updateData.advisors = {
                // set จะทำการลบครูที่ปรึกษาคนเก่าออกทั้งหมด แล้วใส่คนใหม่ใน Array นี้เข้าไปแทน
                // ถ้าส่ง Array ว่างมา [] มันก็จะล้างครูที่ปรึกษาออกให้หมดเลย
                set: dto.advisorIds.map((advisorId: string) => ({ id: advisorId }))
            };
        }

        // 4. สั่ง Update
        return this.prisma.classroom.update({
            where: { id },
            data: updateData,
            include: {
                advisors: {
                    select: { id: true, firstName: true, lastName: true }
                },
                term: true
            }
        });
    }

    async remove(id: number) {
        await this.findOne(id);
        return this.prisma.classroom.delete({
            where: { id },
        });
    }
}
