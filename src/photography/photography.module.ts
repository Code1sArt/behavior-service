import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LineModule } from '../line/line.module';
import { PhotographyController } from './photography.controller';
import { PhotographyService } from './photography.service';
import { PhotographyLineWorker } from './photography-line.worker';

@Module({
  imports: [PrismaModule, NotificationsModule, LineModule],
  controllers: [PhotographyController],
  providers: [PhotographyService, PhotographyLineWorker],
})
export class PhotographyModule {}
