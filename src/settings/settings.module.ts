import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  imports: [PrismaModule],
})
export class SettingsModule {}
