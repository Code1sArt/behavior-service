import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  GoneException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { BindLineDto, LineLoginDto, LoginDto } from './dto/login.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Authentication') // ใช้สำหรับจัดกลุ่ม API ใน Swagger
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST: /auth/register
  @Post('register')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'ลงทะเบียนผู้ใช้ใหม่',
    description: 'สร้างบัญชีผู้ใช้ใหม่ในระบบ',
  })
  @ApiResponse({ status: 201, description: 'ลงทะเบียนสำเร็จ' })
  @ApiResponse({
    status: 409,
    description: 'รหัสประชาชน หรือ รหัสนักเรียนนี้ ถูกลงทะเบียนแล้ว',
  })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  // POST: /auth/login
  @HttpCode(HttpStatus.OK) // ปกติ POST จะคืนค่า 201 แต่ Login ควรเป็น 200 OK
  @Post('login')
  @ApiOperation({
    summary: 'เข้าสู่ระบบ',
    description: 'รับรหัสประจำตัวและรหัสผ่านเพื่อเข้าสู่ระบบ',
  })
  @ApiResponse({ status: 200, description: 'เข้าสู่ระบบสำเร็จ' })
  @ApiResponse({
    status: 401,
    description: 'รหัสประจำตัว หรือ รหัสผ่านไม่ถูกต้อง',
  })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('line/callback')
  @ApiOperation({ summary: 'รับ Callback จาก LINE Login เพื่อผูกบัญชี' })
  async lineCallback() {
    throw new GoneException('กรุณาเชื่อม LINE ผ่านการเข้าสู่ระบบและยืนยันบัญชี');
  }

  @Post('line-login')
  @ApiOperation({ summary: 'Login อัตโนมัติด้วย LINE ID' })
  async lineLogin(@Body() dto: LineLoginDto) {
    return await this.authService.lineLogin(dto);
  }

  @Post('bind-line')
  @ApiOperation({ summary: 'ผูกบัญชี LINE ด้วย รหัสประชาชน+รหัสผ่าน' })
  async bindLineAccount(@Body() dto: BindLineDto) {
    return await this.authService.bindLineAccount(dto);
  }
}
