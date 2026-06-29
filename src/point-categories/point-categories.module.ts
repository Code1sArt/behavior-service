import { Module } from '@nestjs/common';
import { PointCategoriesController } from './point-categories.controller';
import { PointCategoriesService } from './point-categories.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [PointCategoriesController],
  providers: [PointCategoriesService],
  imports: [PrismaModule],
})
export class PointCategoriesModule { }
