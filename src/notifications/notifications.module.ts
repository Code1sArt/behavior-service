import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FirebasePushSender } from './firebase-push.sender';
import { PushWorker } from './push.worker';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationInboxController } from './notification-inbox.controller';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [
    NotificationsController,
    NotificationInboxController,
    BroadcastController,
  ],
  providers: [
    NotificationsService,
    FirebasePushSender,
    PushWorker,
    NotificationInboxService,
    BroadcastService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
