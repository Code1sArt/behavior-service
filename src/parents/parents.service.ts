import { Injectable, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateParentDto } from './dto/create-parent.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from 'src/auth/dto/login.dto';
import { AddChildDto } from './dto/add-child.dto';

@Injectable()
export class ParentsService {
    constructor(private prisma: PrismaService, private jwtService: JwtService) { }

    async register(dto: CreateParentDto) {
        // 1. เช็คว่ามีผู้ปกครองคนนี้ในระบบหรือยัง
        const existingParent = await this.prisma.user.findUnique({
            where: { citizenId: dto.citizenId },
        });
        if (existingParent) {
            throw new ConflictException('รหัสประชาชนผู้ปกครองนี้ ถูกลงทะเบียนแล้ว');
        }

        // 2. เช็คว่า LINE ID นี้เคยผูกกับใครไปหรือยัง (ป้องกันการสวมรอย)
        if (dto.lineUserId) {
            const existingLine = await this.prisma.user.findFirst({
                where: { lineUserId: dto.lineUserId }
            });
            if (existingLine) {
                throw new ConflictException('LINE ID นี้ถูกใช้งานไปแล้ว');
            }
        }

        // 3. ค้นหาข้อมูลนักเรียนที่เป็นบุตรหลาน
        const student = await this.prisma.user.findUnique({
            where: { citizenId: dto.studentCitizenId },
        });

        if (!student || student.role !== Role.STUDENT) {
            throw new NotFoundException('ไม่พบข้อมูลนักเรียน กรุณาตรวจสอบรหัสนักเรียนอีกครั้ง');
        }

        // 4. เข้ารหัสผ่าน
        const hashedPassword = await bcrypt.hash(dto.password, 10);

        // 5. บันทึกข้อมูลผู้ปกครอง และผูก Parent ID ให้กับนักเรียน (ใช้ Transaction เพื่อความชัวร์)
        const result = await this.prisma.$transaction(async (prisma) => {
            // สร้าง User ผู้ปกครอง
            const newParent = await prisma.user.create({
                data: {
                    citizenId: dto.citizenId,
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    password: hashedPassword,
                    role: Role.PARENT,
                    lineUserId: dto.lineUserId || null, // <--- บันทึก LINE ID ตรงนี้
                },
            });

            // อัปเดตข้อมูลนักเรียน ให้เชื่อมกับผู้ปกครองคนนี้
            await prisma.user.update({
                where: { id: student.id },
                data: { parentId: newParent.id },
            });

            return newParent;
        });

        const { password, ...parentData } = result;
        return {
            message: 'ลงทะเบียนผู้ปกครองสำเร็จ',
            user: parentData,
        };
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { citizenId: dto.citizenId },
            include: {
                // หากเป็นผู้ปกครอง ให้ดึงรายชื่อนักเรียนในปกครองมาด้วย
                children: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        classroom: {
                            select: { name: true }
                        }
                    }
                }
            }
        });

        if (!user || !(await bcrypt.compare(dto.password, user.password))) {
            throw new UnauthorizedException('รหัสประจำตัว หรือ รหัสผ่านไม่ถูกต้อง');
        }

        const payload = { sub: user.id, citizenId: user.citizenId, role: user.role };

        return {
            message: 'เข้าสู่ระบบสำเร็จ',
            access_token: this.jwtService.sign(payload),
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                // ส่งรายชื่อลูกๆ กลับไป (ถ้ามี)
                children: user.children || []
            }
        };
    }

    async addChild(parentId: string, dto: AddChildDto) {
        // 1. ตรวจสอบว่านักเรียนคนนี้มีตัวตนจริงไหม
        const student = await this.prisma.user.findUnique({
            where: { citizenId: dto.studentCitizenId },
        });

        if (!student || student.role !== Role.STUDENT) {
            throw new NotFoundException('ไม่พบข้อมูลนักเรียน กรุณาตรวจสอบรหัสอีกครั้ง');
        }

        // 2. ตรวจสอบว่านักเรียนคนนี้ถูกผูกกับผู้ปกครองคนอื่นไปแล้วหรือยัง (เลือกได้ตามนโยบายโรงเรียน)
        if (student.parentId) {
            throw new ConflictException('นักเรียนคนนี้มีผู้ปกครองผูกข้อมูลไว้แล้ว');
        }

        // 3. ผูกความสัมพันธ์
        return this.prisma.user.update({
            where: { id: student.id },
            data: { parentId: parentId },
            select: {
                firstName: true,
                lastName: true,
                classroom: { select: { name: true } }
            }
        });
    }

    async findAll() {
        const parents = await this.prisma.user.findMany({
            where: {
                role: Role.PARENT, // กรองเฉพาะผู้ใช้งานที่มีบทบาทเป็นผู้ปกครอง
            },
            select: {
                id: true,
                citizenId: true,
                firstName: true,
                lastName: true,
                lineUserId: true,
                createdAt: true,
                // ดึงข้อมูลนักเรียนที่เชื่อมโยงกับผู้ปกครองคนนี้
                children: {
                    select: {
                        id: true,
                        citizenId: true,
                        firstName: true,
                        lastName: true,
                        classroom: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return parents;
    }


    async removeParent(parentId: string) {
        // 1. เช็คว่ามีผู้ปกครองคนนี้จริงไหม
        const parent = await this.prisma.user.findUnique({
            where: { id: parentId },
            include: { children: true }
        });

        if (!parent || parent.role !== Role.PARENT) {
            throw new NotFoundException('ไม่พบข้อมูลผู้ปกครอง');
        }

        // 2. ใช้ Transaction เพื่อล้างความสัมพันธ์ก่อนลบตัว User
        await this.prisma.$transaction(async (prisma) => {
            // อัปเดตให้นักเรียนทุกคนที่เคยผูกกับคนนี้ กลายเป็นไม่มีผู้ปกครอง (parentId: null)
            await prisma.user.updateMany({
                where: { parentId: parentId },
                data: { parentId: null }
            });

            // ลบตัวผู้ปกครอง
            await prisma.user.delete({
                where: { id: parentId }
            });
        });

        return { message: 'ลบข้อมูลผู้ปกครองและล้างความสัมพันธ์สำเร็จ' };
    }
}