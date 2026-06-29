import { Module } from '@nestjs/common';
import { HolidaysService } from './holidays.service';
import {
  HolidaysController,
  TermCalendarController,
} from './holidays.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HolidaysController, TermCalendarController],
  providers: [HolidaysService],
})
export class HolidaysModule {}
