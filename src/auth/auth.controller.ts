import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { BindLineDto, LineLoginDto, LoginDto } from './dto/login.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Authentication') // ใช้สำหรับจัดกลุ่ม API ใน Swagger
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    // POST: /auth/register
    @Post('register')
    @ApiOperation({ summary: 'ลงทะเบียนผู้ใช้ใหม่', description: 'สร้างบัญชีผู้ใช้ใหม่ในระบบ' })
    @ApiResponse({ status: 201, description: 'ลงทะเบียนสำเร็จ' })
    @ApiResponse({ status: 409, description: 'รหัสประชาชน หรือ รหัสนักเรียนนี้ ถูกลงทะเบียนแล้ว' })
    register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }

    // POST: /auth/login
    @HttpCode(HttpStatus.OK) // ปกติ POST จะคืนค่า 201 แต่ Login ควรเป็น 200 OK
    @Post('login')
    @ApiOperation({ summary: 'เข้าสู่ระบบ', description: 'รับรหัสประจำตัวและรหัสผ่านเพื่อเข้าสู่ระบบ' })
    @ApiResponse({ status: 200, description: 'เข้าสู่ระบบสำเร็จ' })
    @ApiResponse({ status: 401, description: 'รหัสประจำตัว หรือ รหัสผ่านไม่ถูกต้อง' })
    login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    @Get('line/callback')
    @ApiOperation({ summary: 'รับ Callback จาก LINE Login เพื่อผูกบัญชี' })
    async lineCallback(
        @Query('code') code: string,
        @Query('state') state: string,
        @Res() res: Response // ดึง Response object มาจัดการการ Redirect
    ) {
        // URL ของแอดมินพาเนลฝั่งหน้าบ้าน
        const FRONTEND_SETTINGS_URL = 'http://localhost:5173/settings';

        // ถ้าผู้ใช้กดยกเลิกในหน้า LINE ระบบจะไม่ส่ง code มาให้
        if (!code || !state) {
            return res.redirect(`${FRONTEND_SETTINGS_URL}?error=user_cancelled`);
        }

        try {
            // เรียกใช้ Service เพื่อไปคุยกับ LINE
            await this.authService.linkLineAccount(code, state);

            // ถ้าสำเร็จ เด้งกลับหน้าตั้งค่า พร้อมส่งคำว่า success ไปบน URL
            return res.redirect(`${FRONTEND_SETTINGS_URL}?success=line_linked`);

        } catch (error) {
            // ถ้าพัง (เช่น โค้ดหมดอายุ) เด้งกลับไปพร้อม error
            return res.redirect(`${FRONTEND_SETTINGS_URL}?error=link_failed`);
        }
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
