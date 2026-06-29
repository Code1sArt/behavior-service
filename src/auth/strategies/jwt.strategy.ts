import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || '',
    });
  }

  // สิ่งที่ Return ออกมาจะถูกนำไปผูกไว้ใน req.user อัตโนมัติ
  async validate(payload: any) {
    return { userId: payload.sub, citizenId: payload.citizenId, role: payload.role };
  }
}
