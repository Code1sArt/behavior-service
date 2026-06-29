import { Module } from '@nestjs/common';
import { TermsService } from './terms.service';
import { TermsController } from './terms.controller';
import { Prisma } from '@prisma/client';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  providers: [TermsService],
  controllers: [TermsController],
  imports: [PrismaModule],
})
export class TermsModule { }
