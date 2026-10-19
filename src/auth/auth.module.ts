import { LineIdentityService } from './line-identity.service';
import { OptionalJwtGuard } from './guards/optional-jwt.guard';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' }, // Token หมดอายุใน 1 วัน
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LineIdentityService, OptionalJwtGuard],
  exports: [LineIdentityService, OptionalJwtGuard],
  // exports: [AuthService], // Export AuthService เพื่อให้ Module อื่นๆ สามารถใช้ได้
})
export class AuthModule {}
