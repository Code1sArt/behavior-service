import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LineController } from './line.controller';
import { LineService } from './line.service';

@Module({
  imports: [PrismaModule],
  controllers: [LineController],
  providers: [LineService],
  exports: [LineService], // ถ้าต้องการให้บริการนี้ถูกใช้ในโมดูลอื่น ๆ
})
export class LineModule {}
