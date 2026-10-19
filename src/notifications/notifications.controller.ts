import {
  Body,
  Controller,
  Delete,
  Headers,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { DeviceTokenDto, RegisterDeviceDto } from './device.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications/devices')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly jwt: JwtService,
  ) {}

  private async session(authorization: string) {
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw new UnauthorizedException();
    const payload = await this.jwt.verifyAsync<{ sub: string; exp: number }>(
      token,
      { secret: process.env.JWT_SECRET },
    );
    if (
      !payload.sub ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub, expiresAt: new Date(payload.exp * 1000) };
  }

  @Put()
  async register(
    @Headers('authorization') auth: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    const session = await this.session(auth);
    return this.service.register(session.userId, session.expiresAt, dto);
  }

  @Delete()
  async remove(
    @Headers('authorization') auth: string,
    @Body() dto: DeviceTokenDto,
  ) {
    const session = await this.session(auth);
    return this.service.remove(session.userId, dto.token);
  }
}
