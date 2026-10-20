import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FirebasePushSender } from './firebase-push.sender';
import { PushWorker } from './push.worker';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationInboxController } from './notification-inbox.controller';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [NotificationsController, NotificationInboxController],
  providers: [
    NotificationsService,
    FirebasePushSender,
    PushWorker,
    NotificationInboxService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
