import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePointCategoryDto } from './dto/create-point-category.dto';
import { UpdatePointCategoryDto } from './dto/update-point-category.dto';

@Injectable()
export class PointCategoriesService {
    constructor(private prisma: PrismaService) { }

    async create(dto: CreatePointCategoryDto) {
        return this.prisma.pointCategory.create({
            data: dto,
        });
    }

    async findAll() {
        return this.prisma.pointCategory.findMany({
            orderBy: { id: 'desc' },
        });
    }

    async findOne(id: number) {
        const category = await this.prisma.pointCategory.findUnique({
            where: { id },
        });
        if (!category) throw new NotFoundException(`ไม่พบหมวดหมู่คะแนน ID: ${id}`);
        return category;
    }

    async update(id: number, dto: UpdatePointCategoryDto) {
        await this.findOne(id);
        return this.prisma.pointCategory.update({
            where: { id },
            data: dto,
        });
    }

    async remove(id: number) {
        await this.findOne(id);
        return this.prisma.pointCategory.delete({
            where: { id },
        });
    }
}
