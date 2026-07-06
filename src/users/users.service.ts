import { BadRequestException, Injectable, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import * as bcrypt from 'bcrypt'; // อย่าลืม import bcrypt มาใช้เข้ารหัสผ่าน
import { Prisma, Role } from '@prisma/client';

@Injectable()
export class UsersService {
    constructor(private prisma: PrismaService) { }

    // รับ reqUser มาจาก Token JWT เพื่อดูว่าใครเป็นคนกด request เข้ามา
    async updateUser(targetId: string, reqUser: any, dto: UpdateUserDto) {
        // 1. ตรวจสอบสิทธิ์ (Authorization)
        // ถ้าไม่ใช่ ADMIN และพยายามจะแก้ ID ที่ไม่ใช่ของตัวเอง -> เตะออกทันที
        if (reqUser.role !== Role.ADMIN && reqUser.userId !== targetId) {
            throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขข้อมูลของผู้ใช้งานท่านอื่น');
        }

        // 2. ป้องกัน User ธรรมดาแอบเลื่อนขั้นตัวเองเป็น ADMIN (สำคัญมาก!)
        if (reqUser.role !== Role.ADMIN && dto.role) {
            throw new ForbiddenException('คุณไม่มีสิทธิ์เปลี่ยนระดับสิทธิ์ (Role) ด้วยตัวเอง');
        }

        // 3. เช็คว่ามี User คนนี้อยู่ในฐานข้อมูลจริงๆ ไหม
        const existingUser = await this.prisma.user.findUnique({ where: { id: targetId } });
        if (!existingUser) {
            throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งานที่ต้องการแก้ไข');
        }

        if (
            existingUser.role === Role.STUDENT &&
            dto.classroomId !== undefined &&
            dto.classroomId !== existingUser.classroomId
        ) {
            throw new BadRequestException(
                'กรุณาย้ายห้องนักเรียนผ่าน API จัดการนักเรียน เพื่อให้ระบบเก็บประวัติห้องเรียน',
            );
        }
        if (
            dto.role !== undefined &&
            dto.role !== existingUser.role &&
            (dto.role === Role.STUDENT || existingUser.role === Role.STUDENT)
        ) {
            throw new BadRequestException(
                'ไม่สามารถเปลี่ยนเข้า/ออกจากบทบาทนักเรียนผ่าน API ผู้ใช้งานทั่วไปได้',
            );
        }
        if (
            reqUser.role === Role.ADMIN &&
            reqUser.userId === targetId &&
            dto.role !== undefined &&
            dto.role !== existingUser.role
        ) {
            throw new ForbiddenException(
                'ไม่สามารถเปลี่ยนระดับสิทธิ์ของบัญชีที่กำลังใช้งานได้',
            );
        }

        // 4. เตรียมข้อมูลที่จะอัปเดต
        const updateData: any = { ...dto };

        // ถ้ามีการเปลี่ยนรหัสผ่าน ต้องเอาไป Hash ก่อนบันทึกเสมอ
        if (dto.password) {
            const salt = await bcrypt.genSalt();
            updateData.password = await bcrypt.hash(dto.password, salt);
        }

        // 5. สั่งอัปเดตลง Database
        const updatedUser = await this.prisma.user.update({
            where: { id: targetId },
            data: updateData,
        });

        // ลบรหัสผ่านออกจาก Response ป้องกันข้อมูลหลุดไปหน้าบ้าน
        const { password, ...userWithoutPassword } = updatedUser;

        return {
            message: 'อัปเดตข้อมูลสำเร็จ',
            user: userWithoutPassword
        };
    }

    async getMe(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                // ดึงข้อมูลห้องเรียน (ถ้าเป็นนักเรียน)
                classroom: true,
                // ดึงข้อมูลห้องที่ปรึกษา (ถ้าเป็นครูที่ปรึกษา)
                advisingClasses: true,
                // ดึงข้อมูลลูกๆ (ถ้าเป็นผู้ปกครอง)
                children: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        classroom: {
                            select: { name: true }
                        }
                    }
                },
                // ดึงข้อมูลผู้ปกครอง (ถ้าเป็นนักเรียน)
                parent: {
                    select: {
                        firstName: true,
                        lastName: true,
                        lineUserId: true
                    }
                }
            },
        });

        if (!user) {
            throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งาน');
        }

        // ลบรหัสผ่านออกก่อนส่งกลับไปที่หน้าบ้าน
        const { password, ...result } = user;
        return result;
    }

    async changePassword(userId: string, dto: ChangePasswordDto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });

        if (!user) {
            throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งาน');
        }

        const isCurrentPasswordValid = await bcrypt.compare(dto.oldPassword, user.password);
        if (!isCurrentPasswordValid) {
            throw new UnauthorizedException('รหัสผ่านปัจจุบันไม่ถูกต้อง');
        }

        if (dto.oldPassword === dto.newPassword) {
            throw new BadRequestException('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน');
        }

        const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
        await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });

        return { message: 'เปลี่ยนรหัสผ่านสำเร็จ' };
    }

    async removeUser(targetId: string, reqUser: any) {
        if (reqUser.role !== Role.ADMIN) {
            throw new ForbiddenException('คุณไม่มีสิทธิ์ลบผู้ใช้งาน');
        }

        const existingUser = await this.prisma.user.findUnique({
            where: { id: targetId },
        });

        if (!existingUser) {
            throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งานที่ต้องการลบ');
        }

        try {
            const deletedUser = await this.prisma.user.delete({
                where: { id: targetId },
                select: {
                    id: true,
                    citizenId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    lineUserId: true,
                    classroomId: true,
                    parentId: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            return {
                message: 'ลบผู้ใช้งานสำเร็จ',
                user: deletedUser,
            };
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
                throw new BadRequestException('ไม่สามารถลบผู้ใช้งานนี้ได้ เนื่องจากมีข้อมูลที่เกี่ยวข้องอยู่ในระบบ');
            }

            throw error;
        }
    }
}
