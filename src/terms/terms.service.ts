import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class TermsService {
    constructor(private prisma: PrismaService) { }

    private validateDateRange(startDate: Date, endDate: Date) {
        if (startDate > endDate) {
            throw new BadRequestException('วันเริ่มต้นของปีการศึกษาต้องไม่อยู่หลังวันสิ้นสุดของปีการศึกษา');
        }
    }

    async create(dto: CreateTermDto) {
        const startDate = new Date(dto.startDate);
        const endDate = new Date(dto.endDate);

        this.validateDateRange(startDate, endDate); 

        try {
            return await this.prisma.$transaction(async (tx) => {
                const duplicate = await tx.academicTerm.findUnique({
                    where: {
                        year_term: {
                            year: dto.year,
                            term: dto.term,
                        },
                    },
                });

                if (duplicate) {
                    throw new ConflictException(
                        `ปีการศึกษา ${dto.year} ภาคเรียนที่ ${dto.term} มีอยู่แล้ว`,
                    );
                }

                // ทำเฉพาะเมื่อโรงเรียนเปิดใช้ข้อจำกัดนี้
                const overlappingTerm = await tx.academicTerm.findFirst({ 
                    where: {
                        startDate: { lte: endDate },
                        endDate: { gte: startDate },
                    },
                });

                if (overlappingTerm) {
                    throw new ConflictException(
                        `ช่วงวันที่ทับกับปีการศึกษา ${overlappingTerm.year} ` +
                        `ภาคเรียนที่ ${overlappingTerm.term}`,
                    );
                }

                if (dto.isActive) {
                    await tx.academicTerm.updateMany({
                        where: { isActive: true },
                        data: { isActive: false },
                    });
                }

                return tx.academicTerm.create({
                    data: {
                        ...dto,
                        startDate,
                        endDate,
                    },
                });
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    `ปีการศึกษา ${dto.year} ภาคเรียนที่ ${dto.term} มีอยู่แล้ว`,
                );
            }

            throw error;
        }
    }

    async findAll() {
        return this.prisma.academicTerm.findMany({
            // เรียงจากปีการศึกษาล่าสุด และภาคเรียนล่าสุดขึ้นก่อน
            orderBy: [
                { year: 'desc' },
                { term: 'desc' },
            ],
        });
    }

    async findOne(id: number) {
        const academicTerm = await this.prisma.academicTerm.findUnique({
            where: { id },
        });
        if (!academicTerm) throw new NotFoundException(`ไม่พบข้อมูลภาคเรียน ID: ${id}`);
        return academicTerm;
    }

    async update(id: number, dto: UpdateTermDto) {
        const existingTerm = await this.findOne(id);
        const year = dto.year ?? existingTerm.year;
        const term = dto.term ?? existingTerm.term;
        const startDate = dto.startDate
            ? new Date(dto.startDate)
            : existingTerm.startDate;
        const endDate = dto.endDate
            ? new Date(dto.endDate)
            : existingTerm.endDate;

        this.validateDateRange(startDate, endDate);

        try {
            return await this.prisma.$transaction(async (tx) => {
                const duplicate = await tx.academicTerm.findFirst({
                    where: {
                        id: { not: id },
                        year,
                        term,
                    },
                });

                if (duplicate) {
                    throw new ConflictException(
                        `ปีการศึกษา ${year} ภาคเรียนที่ ${term} มีอยู่แล้ว`,
                    );
                }

                const overlappingTerm = await tx.academicTerm.findFirst({
                    where: {
                        id: { not: id },
                        startDate: { lte: endDate },
                        endDate: { gte: startDate },
                    },
                });

                if (overlappingTerm) {
                    throw new ConflictException(
                        `ช่วงวันที่ทับกับปีการศึกษา ${overlappingTerm.year} ` +
                        `ภาคเรียนที่ ${overlappingTerm.term}`,
                    );
                }

                if (dto.isActive === true) {
                    await tx.academicTerm.updateMany({
                        where: { id: { not: id }, isActive: true },
                        data: { isActive: false },
                    });
                }

                return tx.academicTerm.update({
                    where: { id },
                    data: {
                        ...dto,
                        startDate,
                        endDate,
                    },
                });
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new ConflictException(
                    `ปีการศึกษา ${year} ภาคเรียนที่ ${term} มีอยู่แล้ว`,
                );
            }

            throw error;
        }
    }

    async remove(id: number) {
        await this.findOne(id);
        return this.prisma.academicTerm.delete({
            where: { id },
        });
    }
}
