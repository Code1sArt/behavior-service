import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { StaffEmailOtpController } from './staff-email-otp.controller';
import { StaffEmailOtpService } from './staff-email-otp.service';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LineIdentityService } from './line-identity.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const staff = {
  requestRegistration: jest.fn(() => ({})),
  requestLogin: jest.fn(() => ({})),
  verify: jest.fn(() => ({})),
};
const valid = {
  email: 'staff@example.com',
  citizenId: '1234567890123',
  password: 'school-password',
  role: 'TEACHER',
};

describe('Staff OTP HTTP contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StaffEmailOtpController],
      providers: [{ provide: StaffEmailOtpService, useValue: staff }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });
  it.each([
    { role: 'STUDENT' },
    { role: 'PARENT' },
    { role: 'MADE_UP' },
    { citizenId: '123' },
    { citizenId: '123456789012x' },
    { email: 'invalid' },
    { password: '' },
  ])('rejects invalid registration input %j', async (patch) => {
    await request(app.getHttpServer())
      .post('/auth/staff/register/request')
      .send({ ...valid, ...patch })
      .expect(400);
    expect(staff.requestRegistration).not.toHaveBeenCalled();
  });
  it('allows staff registration and normalizes the address', async () => {
    await request(app.getHttpServer())
      .post('/auth/staff/register/request')
      .send({ ...valid, email: ' Staff@Example.com ' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(staff.requestRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'staff@example.com' }),
      expect.any(String),
    );
  });
  it('never accepts role/email/citizenId overrides in OTP verification', async () => {
    await request(app.getHttpServer())
      .post('/auth/staff/verify')
      .send({
        challengeId: 'ab4b34fc-bd5f-4bcc-8174-57b1b8bca513',
        code: '012345',
        role: 'ADMIN',
        email: 'attacker@example.com',
      })
      .expect(200);
    expect(staff.verify).toHaveBeenCalledWith(
      expect.objectContaining({ code: '012345' }),
      expect.any(String),
    );
    expect(staff.verify.mock.calls[0][0]).not.toHaveProperty('role');
    expect(staff.verify.mock.calls[0][0]).not.toHaveProperty('email');
  });
  it('rejects malformed OTP before business logic', async () => {
    await request(app.getHttpServer())
      .post('/auth/staff/verify')
      .send({ challengeId: 'not-a-uuid', code: '123' })
      .expect(400);
    expect(staff.verify).not.toHaveBeenCalled();
  });
});

describe.each(['true', 'false'])(
  'Web and LINE remain compatible when app OTP flag=%s',
  (enabled) => {
    let auth: AuthService;
    let db: any;
    let jwt: any;
    let identity: any;
    let previousFlag: string | undefined;
    beforeEach(async () => {
      previousFlag = process.env.STAFF_EMAIL_OTP_ENABLED;
      process.env.STAFF_EMAIL_OTP_ENABLED = enabled;
      const user = {
        id: 'u',
        citizenId: '1234567890123',
        role: Role.TEACHER,
        password: await bcrypt.hash('password', 4),
        lineUserId: 'line-id',
      };
      db = {
        user: {
          findUnique: jest.fn(async () => user),
          update: jest.fn(async ({ data }) => ({ ...user, ...data })),
        },
      };
      jwt = { sign: jest.fn(() => 'token') };
      identity = { verify: jest.fn(async () => 'line-id') };
      auth = new AuthService(
        db as PrismaService,
        jwt as JwtService,
        identity as LineIdentityService,
      );
    });
    afterEach(() => {
      if (previousFlag === undefined)
        delete process.env.STAFF_EMAIL_OTP_ENABLED;
      else process.env.STAFF_EMAIL_OTP_ENABLED = previousFlag;
    });
    it.each([
      Role.TEACHER,
      Role.AFFAIRS,
      Role.ADMIN,
      Role.STUDENT,
      Role.PARENT,
    ])('keeps the existing web password contract for %s', async (role) => {
      const user = await db.user.findUnique({});
      user.role = role;
      await expect(
        auth.login({ citizenId: user.citizenId, password: 'password' }),
      ).resolves.toHaveProperty('access_token', 'token');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, role }),
      );
    });
    it.each([Role.TEACHER, Role.AFFAIRS, Role.ADMIN])(
      'keeps verified LINE auto-login for %s',
      async (role) => {
        const user = await db.user.findUnique({});
        user.role = role;
        await expect(
          auth.lineLogin({ accessToken: 'verified', lineUserId: 'line-id' }),
        ).resolves.toMatchObject({
          requires_binding: false,
          access_token: 'token',
        });
        expect(identity.verify).toHaveBeenCalledWith('verified', 'line-id');
        expect(jwt.sign).toHaveBeenCalledWith(
          expect.objectContaining({ sub: user.id, role }),
        );
      },
    );
    it.each([Role.TEACHER, Role.AFFAIRS, Role.ADMIN])(
      'keeps verified LINE binding for %s',
      async (role) => {
        const user = await db.user.findUnique({});
        user.role = role;
        await expect(
          auth.bindLineAccount({
            accessToken: 'verified',
            lineUserId: 'line-id',
            citizenId: user.citizenId,
            password: 'password',
          }),
        ).resolves.toHaveProperty('access_token', 'token');
        expect(identity.verify).toHaveBeenCalledWith('verified', 'line-id');
        expect(db.user.update).toHaveBeenCalledWith({
          where: { id: user.id },
          data: { lineUserId: 'line-id' },
        });
        expect(jwt.sign).toHaveBeenCalledWith(
          expect.objectContaining({ sub: user.id, role }),
        );
      },
    );
    it('still rejects selecting STUDENT for a staff account', async () => {
      await expect(
        auth.login({
          citizenId: '1234567890123',
          password: 'password',
          role: Role.STUDENT,
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(jwt.sign).not.toHaveBeenCalled();
    });
    it('still rejects an incorrect password', async () => {
      await expect(
        auth.login({ citizenId: '1234567890123', password: 'wrong-password' }),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        auth.bindLineAccount({
          accessToken: 'verified',
          lineUserId: 'line-id',
          citizenId: '1234567890123',
          password: 'wrong-password',
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(db.user.update).not.toHaveBeenCalled();
    });
    it('still rejects a LINE identity that fails verification', async () => {
      identity.verify.mockRejectedValue(new UnauthorizedException());
      await expect(
        auth.lineLogin({ accessToken: 'invalid', lineUserId: 'line-id' }),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        auth.bindLineAccount({
          accessToken: 'invalid',
          lineUserId: 'line-id',
          citizenId: '1234567890123',
          password: 'password',
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });
    it('still prevents replacing an existing LINE link with another account', async () => {
      identity.verify.mockResolvedValue('another-line-id');
      await expect(
        auth.bindLineAccount({
          accessToken: 'verified',
          lineUserId: 'another-line-id',
          citizenId: '1234567890123',
          password: 'password',
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(db.user.update).not.toHaveBeenCalled();
      expect(jwt.sign).not.toHaveBeenCalled();
    });
  },
);
