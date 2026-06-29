import { Module } from '@nestjs/common';
import { BehaviorsController } from './behaviors.controller';
import { BehaviorsService } from './behaviors.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LineModule } from 'src/line/line.module';

@Module({
  controllers: [BehaviorsController],
  providers: [BehaviorsService],
  imports: [PrismaModule, LineModule],
})
export class BehaviorsModule {}
