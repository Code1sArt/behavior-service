import { Module } from '@nestjs/common';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [ClassroomsController],
  providers: [ClassroomsService],
  imports: [PrismaModule],
})
export class ClassroomsModule {}
