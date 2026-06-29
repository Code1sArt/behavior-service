import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { BindLineDto, LineLoginDto, LoginDto } from './dto/login.dto';
import axios from 'axios'; // นำเข้า axios

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) { }

  // ==========================================
  // API สำหรับลงทะเบียน (Register)
  // ==========================================
  async register(dto: RegisterDto) {
    // 1. เช็คว่ามีผู้ใช้นี้ในระบบหรือยัง
    const existingUser = await this.prisma.user.findUnique({
      where: { citizenId: dto.citizenId },
    });

    if (existingUser) {
      throw new ConflictException('รหัสประชาชน หรือ รหัสนักเรียนนี้ ถูกลงทะเบียนแล้ว');
    }

    // 2. เข้ารหัสผ่าน (Hash Password) ด้วยความยากระดับ 10
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // 3. บันทึกลง Database
    const newUser = await this.prisma.user.create({
      data: {
        citizenId: dto.citizenId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        password: hashedPassword,
      },
    });

    // 4. คืนค่าข้อมูลกลับไป (แต่ตัด Password ออกเพื่อความปลอดภัย)
    const { password, ...result } = newUser;
    return {
      message: 'ลงทะเบียนสำเร็จ',
      user: result,
    };
  }

  // ==========================================
  // API สำหรับเข้าสู่ระบบ (Login)
  // ==========================================
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { citizenId: dto.citizenId },
    });

    // เช็คว่ามี User และรหัสผ่านตรงกันหรือไม่ (ใช้ bcrypt.compare)
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('รหัสประจำตัว หรือ รหัสผ่านไม่ถูกต้อง');
    }

    const payload = { sub: user.id, citizenId: user.citizenId, role: user.role };

    return {
      message: 'เข้าสู่ระบบสำเร็จ',
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      }
    };
  }

  async linkLineAccount(code: string, state: string) {
    try {
      // 1. เอา Code ที่ได้มา ไปแลกเป็น Access Token จาก LINE
      // LINE บังคับให้ส่งแบบ x-www-form-urlencoded เราเลยต้องใช้ URLSearchParams
      const tokenResponse = await axios.post(
        'https://api.line.me/oauth2/v2.1/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: 'http://localhost:3000/auth/line/callback', // ต้องตรงกับที่ตั้งค่าใน LINE Console เป๊ะๆ
          client_id: process.env.LINE_LOGIN_CHANNEL_ID || '',
          client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // 2. เอา Access Token ไปดึงข้อมูลโปรไฟล์ เพื่อเอาค่า userId ของ LINE
      const profileResponse = await axios.get('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const lineUserId = profileResponse.data.userId;

      // 3. อัปเดตลง Database 
      // ตัวแปร state ที่ส่งมาคือ id ของตาราง User เราก็จับคู่ผูกกันได้เลย
      await this.prisma.user.update({
        where: { id: state },
        data: { lineUserId: lineUserId },
      });

      return true;
    } catch (error: any) {
      console.error('LINE API Error:', error.response?.data || error.message);
      throw new BadRequestException('ไม่สามารถเชื่อมต่อบัญชี LINE ได้ รหัสอาจหมดอายุ');
    }
  }

  async lineLogin(dto: LineLoginDto) {
    // 1. ค้นหา User ที่มี lineUserId นี้
    const user = await this.prisma.user.findUnique({
      where: { lineUserId: dto.lineUserId },
    });

    // 2. ถ้าไม่เจอแปลว่ายังไม่เคยผูกบัญชี ให้บอก Frontend ไปโชว์หน้า Login
    if (!user) {
      return { requires_binding: true };
    }

    // 3. ถ้าเจอแล้ว สร้าง Token ออกบัตรผ่านให้เลย (Auto Login)
    const payload = { sub: user.id, citizenId: user.citizenId, role: user.role };
    return {
      requires_binding: false,
      message: 'เข้าสู่ระบบอัตโนมัติสำเร็จ',
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      }
    };
  }

  async bindLineAccount(dto: BindLineDto) {
    // 1. ตรวจสอบว่า Citizen ID และรหัสผ่าน ถูกต้องหรือไม่
    const user = await this.prisma.user.findUnique({
      where: { citizenId: dto.citizenId },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('รหัสประจำตัว หรือ รหัสผ่านไม่ถูกต้อง');
    }

    // 2. ป้องกันการเอา LINE อื่นมาสวมรอย (ถ้ามีคนผูกไว้แล้ว และไม่ใช่ตัวเอง)
    if (user.lineUserId && user.lineUserId !== dto.lineUserId) {
      throw new ConflictException('บัญชีนี้ถูกผูกกับ LINE อื่นไปแล้ว กรุณาติดต่อแอดมิน');
    }

    // 3. อัปเดต lineUserId ลงไปในตาราง User
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lineUserId: dto.lineUserId },
    });

    // 4. ออก Token ให้เลยหลังจากผูกเสร็จ
    const payload = { sub: updatedUser.id, citizenId: updatedUser.citizenId, role: updatedUser.role };
    return {
      message: 'ผูกบัญชี LINE สำเร็จ',
      access_token: this.jwtService.sign(payload),
      user: {
        id: updatedUser.id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
      }
    };
  }

}
