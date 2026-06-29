import { Module } from '@nestjs/common';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';
import { Prisma } from '@prisma/client';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [SummaryController],
  providers: [SummaryService],
  imports: [PrismaModule],
})
export class SummaryModule {}
