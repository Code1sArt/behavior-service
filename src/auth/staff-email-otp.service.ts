import {
  ConflictException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BrevoEmailService } from './brevo-email.service';
import {
  StaffLoginRequestDto,
  StaffOtpVerifyDto,
  StaffRegisterRequestDto,
} from './dto/staff-email-otp.dto';
import { STAFF_ROLES } from './staff-otp.policy';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const invalid = () =>
  new UnauthorizedException(
    'ข้อมูลบัญชี บทบาท หรือรหัสยืนยันไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่',
  );
const limited = (message: string) => new HttpException(message, 429);

@Injectable()
export class StaffEmailOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: BrevoEmailService,
  ) {}

  private mac(value: string) {
    return createHmac('sha256', process.env.STAFF_OTP_SECRET!)
      .update(value)
      .digest('hex');
  }

  private credentialHash(password: string) {
    return createHash('sha256').update(password).digest('hex');
  }

  private async throttle(ip: string, identifier: string, verification = false) {
    this.email.assertConfigured();
    const now = Date.now();
    const hour = Math.floor(now / (60 * MINUTE));
    const expiresAt = new Date((hour + 2) * 60 * MINUTE);
    // Persistent counters cover all API processes. IPs and identifiers are HMACed.
    // Shared school Wi-Fi must allow the full staff cohort.
    for (const [key, limit] of [
      [
        `ip-${verification ? 'verify' : 'request'}:${this.mac(ip)}:${hour}`,
        verification ? 1600 : 600,
      ],
      [
        `${verification ? 'verify' : 'request'}:${this.mac(identifier)}:${hour}`,
        verification ? 15 : 10,
      ],
    ] as const) {
      const bucket = await this.prisma.emailOtpBucket
        .upsert({
          where: { key },
          create: { key, count: 1, expiresAt },
          update: { count: { increment: 1 } },
        })
        .catch((error: unknown) => {
          // MySQL Prisma upsert can race while creating a new window.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            return this.prisma.emailOtpBucket.update({
              where: { key },
              data: { count: { increment: 1 } },
            });
          }
          throw error;
        });
      if (bucket.count > limit)
        throw limited(
          'ขอรหัสหรือลองยืนยันบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
        );
    }
  }

  async requestRegistration(dto: StaffRegisterRequestDto, ip: string) {
    await this.throttle(ip, `register:${dto.citizenId}`);
    const user = await this.prisma.user.findUnique({
      where: { citizenId: dto.citizenId },
    });
    await this.checkCredentials(user, dto.password, dto.role);
    if (user!.emailVerifiedAt || user!.email) {
      throw new ConflictException(
        'บัญชีนี้ลงทะเบียนอีเมลแล้ว กรุณาเข้าสู่ระบบด้วยอีเมลเดิม หรือติดต่อโรงเรียน',
      );
    }
    // Claim an existing school-provisioned account, never create a privileged role.
    return this.issue(user!, dto.email.trim().toLowerCase(), 'REGISTER');
  }

  async requestLogin(dto: StaffLoginRequestDto, ip: string) {
    const email = dto.email.trim().toLowerCase();
    await this.throttle(ip, `login:${email}`);
    const user = await this.prisma.user.findUnique({ where: { email } });
    await this.checkCredentials(user, dto.password, dto.role);
    if (!user!.emailVerifiedAt) throw invalid();
    return this.issue(user!, email, 'LOGIN');
  }

  private async checkCredentials(
    user: User | null,
    password: string,
    role: Role,
  ) {
    // Fixed bcrypt work for unknown accounts avoids a cheap account-existence probe.
    const hash =
      user?.password ??
      '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const valid = await bcrypt.compare(password, hash);
    if (
      !user ||
      !STAFF_ROLES.includes(user.role) ||
      user.role !== role ||
      !valid
    )
      throw invalid();
  }

  private async issue(
    user: User,
    email: string,
    purpose: 'REGISTER' | 'LOGIN',
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * MINUTE);
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const configuredLimit = Number(process.env.STAFF_OTP_DAILY_LIMIT ?? 280);
    const dailyLimit =
      Number.isInteger(configuredLimit) &&
      configuredLimit >= 1 &&
      configuredLimit <= 300
        ? configuredLimit
        : 280;
    await this.prisma.$transaction(async (tx) => {
      // Acquire the same DB row lock for all issuers, before counting/reserving a send.
      await tx.$executeRaw`INSERT INTO EmailOtpBucket (\`key\`, \`count\`, expiresAt)
        VALUES ('send-lock', 1, '2099-01-01')
        ON DUPLICATE KEY UPDATE \`count\` = \`count\` + 1`;
      const recent = await tx.staffEmailOtp.findFirst({
        where: {
          userId: user.id,
          createdAt: { gt: new Date(now.getTime() - MINUTE) },
        },
      });
      if (recent)
        throw limited('กรุณารออย่างน้อย 60 วินาทีก่อนขอ OTP อีกครั้ง');
      const window = { createdAt: { gt: new Date(now.getTime() - DAY) } };
      if ((await tx.staffEmailOtp.count({ where: window })) >= dailyLimit) {
        throw limited('โควตาส่งอีเมล OTP วันนี้เต็มแล้ว กรุณาติดต่อโรงเรียน');
      }
      if (
        (await tx.staffEmailOtp.count({
          where: { ...window, userId: user.id },
        })) >= 10
      ) {
        throw limited(
          'บัญชีนี้ขอ OTP ครบจำนวนที่กำหนดแล้ว กรุณาติดต่อโรงเรียน',
        );
      }
      if (purpose === 'REGISTER') {
        const owner = await tx.user.findUnique({ where: { email } });
        if (owner)
          throw new ConflictException(
            'ไม่สามารถใช้อีเมลนี้ลงทะเบียนได้ กรุณาใช้อีเมลอื่นหรือติดต่อโรงเรียน',
          );
      }
      await tx.staffEmailOtp.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.staffEmailOtp.create({
        data: {
          id,
          userId: user.id,
          email,
          purpose,
          role: user.role,
          codeHash: this.mac(`${id}:${code}`),
          credentialHash: this.credentialHash(user.password),
          expiresAt,
          createdAt: now,
        },
      });
    });
    try {
      await this.email.sendOtp(email, code, purpose === 'REGISTER');
      await this.prisma.staffEmailOtp.update({
        where: { id },
        data: { sentAt: new Date() },
      });
    } catch (error) {
      // Failed/uncertain deliveries still count against the reserved send budget.
      await this.prisma.staffEmailOtp.updateMany({
        where: { id },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    const [local, domain] = email.split('@');
    return {
      challengeId: id,
      emailHint: `${local.slice(0, 1)}***@${domain}`,
      expiresAt: expiresAt.toISOString(),
      retryAfterSeconds: 60,
    };
  }

  async verify(dto: StaffOtpVerifyDto, ip: string) {
    await this.throttle(ip, dto.challengeId, true);
    const now = new Date();
    let user: User | null;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        // Increment and lock BEFORE reading. Failed attempts must commit too.
        const attempt = await tx.staffEmailOtp.updateMany({
          where: {
            id: dto.challengeId,
            consumedAt: null,
            sentAt: { not: null },
            expiresAt: { gt: now },
            attempts: { lt: 5 },
          },
          data: { attempts: { increment: 1 } },
        });
        if (attempt.count !== 1) return null;
        const challenge = await tx.staffEmailOtp.findUnique({
          where: { id: dto.challengeId },
        });
        if (!challenge) return null;
        const expected = Buffer.from(challenge.codeHash, 'hex');
        const supplied = Buffer.from(
          this.mac(`${dto.challengeId}:${dto.code}`),
          'hex',
        );
        if (
          expected.length !== supplied.length ||
          !timingSafeEqual(expected, supplied)
        )
          return null;
        const account = await tx.user.findUnique({
          where: { id: challenge.userId },
        });
        if (
          !account ||
          account.role !== challenge.role ||
          !STAFF_ROLES.includes(account.role) ||
          this.credentialHash(account.password) !== challenge.credentialHash
        )
          return null;
        const registration = challenge.purpose === 'REGISTER';
        if (
          registration
            ? !!(account.email || account.emailVerifiedAt)
            : account.email !== challenge.email || !account.emailVerifiedAt
        )
          return null;
        // CAS also locks the user row against concurrent password/role/email edits.
        const updated = await tx.user.updateMany({
          where: {
            id: account.id,
            password: account.password,
            role: challenge.role,
            email: registration ? null : challenge.email,
            emailVerifiedAt: account.emailVerifiedAt,
          },
          data: registration
            ? { email: challenge.email, emailVerifiedAt: now }
            : { emailVerifiedAt: account.emailVerifiedAt },
        });
        if (updated.count !== 1) return null;
        await tx.staffEmailOtp.update({
          where: { id: challenge.id },
          data: { consumedAt: now },
        });
        return account;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'ไม่สามารถใช้อีเมลนี้ลงทะเบียนได้ กรุณาติดต่อโรงเรียน',
        );
      }
      throw error;
    }
    if (!user) throw invalid();
    return {
      message: 'ยืนยันอีเมลและเข้าสู่ระบบสำเร็จ',
      access_token: this.jwt.sign({
        sub: user.id,
        citizenId: user.citizenId,
        role: user.role,
        amr: ['pwd', 'email_otp'],
      }),
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }
}
