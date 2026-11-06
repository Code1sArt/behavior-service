import { AuthModule } from '../auth/auth.module';
import { Module } from '@nestjs/common';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { JwtModule } from '@nestjs/jwt';
import { ClassroomParentLinksService } from './classroom-parent-links.service';
import { ParentInvitationThrottleGuard } from './parent-invitation-throttle.guard';

@Module({
  controllers: [ParentsController],
  providers: [
    ParentsService,
    ClassroomParentLinksService,
    ParentInvitationThrottleGuard,
  ],
  imports: [
    AuthModule,
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' }, // Token หมดอายุใน 1 วัน
    }),
  ],
})
export class ParentsModule {}
