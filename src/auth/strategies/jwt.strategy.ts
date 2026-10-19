import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || '',
    });
  }

  // สิ่งที่ Return ออกมาจะถูกนำไปผูกไว้ใน req.user อัตโนมัติ
  async validate(payload: any) {
    if (typeof payload.sub !== 'string') throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, citizenId: true, role: true },
    });
    if (!user) throw new UnauthorizedException();
    return { userId: user.id, citizenId: user.citizenId, role: user.role };
  }
}
