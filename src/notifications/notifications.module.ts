import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FirebasePushSender } from './firebase-push.sender';
import { PushWorker } from './push.worker';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, FirebasePushSender, PushWorker],
  exports: [NotificationsService],
})
export class NotificationsModule {}
