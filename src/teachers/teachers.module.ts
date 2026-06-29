import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [TeachersController],
  providers: [TeachersService],
  imports: [PrismaModule],
})
export class TeachersModule { }
