import { Body, Controller, Header, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StaffEmailOtpService } from './staff-email-otp.service';
import {
  StaffLoginRequestDto,
  StaffOtpVerifyDto,
  StaffRegisterRequestDto,
} from './dto/staff-email-otp.dto';

@ApiTags('Staff email authentication')
@Controller('auth/staff')
export class StaffEmailOtpController {
  constructor(private readonly service: StaffEmailOtpService) {}

  @Post('register/request')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  register(@Body() dto: StaffRegisterRequestDto, @Ip() ip: string) {
    return this.service.requestRegistration(dto, ip);
  }

  @Post('login/request')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() dto: StaffLoginRequestDto, @Ip() ip: string) {
    return this.service.requestLogin(dto, ip);
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  verify(@Body() dto: StaffOtpVerifyDto, @Ip() ip: string) {
    return this.service.verify(dto, ip);
  }
}
