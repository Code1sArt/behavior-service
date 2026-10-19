import { StudentAccessService } from './student-access.service';
import { Module } from '@nestjs/common';
import { PrismaController } from './prisma.controller';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [PrismaController],
  providers: [PrismaService, StudentAccessService],
  exports: [PrismaService, StudentAccessService],
})
export class PrismaModule {}
