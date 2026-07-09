import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LineModule } from 'src/line/line.module';

@Module({
  controllers: [StudentsController],
  providers: [StudentsService],
  imports: [PrismaModule, LineModule],
})
export class StudentsModule {}
