import { Module } from '@nestjs/common';
import { LineService } from './line.service';

@Module({
  providers: [LineService],
  exports: [LineService], // ถ้าต้องการให้บริการนี้ถูกใช้ในโมดูลอื่น ๆ
})
export class LineModule {}
