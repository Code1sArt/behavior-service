import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, createHmac } from 'node:crypto';
import { StaffEmailOtpService } from './staff-email-otp.service';
import { BrevoEmailService } from './brevo-email.service';
import { PrismaService } from '../prisma/prisma.service';

const secret = 'isolated-staff-otp-test-secret-32-characters';
const challengeId = 'ab4b34fc-bd5f-4bcc-8174-57b1b8bca513';
const password = 'SchoolPassword123!';
const mac = (value: string) =>
  createHmac('sha256', secret).update(value).digest('hex');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('Staff email OTP identity and lifecycle', () => {
  let service: StaffEmailOtpService;
  let account: any;
  let challenge: any;
  let db: any;
  let mail: any;
  let jwt: any;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
  });
  beforeEach(() => {
    process.env.STAFF_OTP_SECRET = secret;
    account = {
      id: 'teacher',
      citizenId: '1234567890123',
      role: Role.TEACHER,
      password: passwordHash,
      firstName: 'Teacher',
      lastName: 'Test',
      email: null,
      emailVerifiedAt: null,
    };
    challenge = {
      id: challengeId,
      userId: account.id,
      email: 'teacher@example.com',
      role: Role.TEACHER,
      purpose: 'REGISTER',
      codeHash: mac(`${challengeId}:012345`),
      credentialHash: digest(passwordHash),
      attempts: 0,
      sentAt: new Date(),
      consumedAt: null,
      expiresAt: new Date(Date.now() + 300_000),
    };
    db = {
      $executeRaw: jest.fn(async () => 1),
      emailOtpBucket: { upsert: jest.fn(async () => ({ count: 1 })) },
      user: {
        findUnique: jest.fn(async ({ where }) =>
          where.email
            ? account?.email === where.email
              ? { ...account }
              : null
            : account
              ? { ...account }
              : null,
        ),
        updateMany: jest.fn(async ({ data }) => {
          Object.assign(account, data);
          return { count: 1 };
        }),
      },
      staffEmailOtp: {
        findFirst: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }) => data),
        update: jest.fn(async ({ data }) => {
          Object.assign(challenge, data);
          return challenge;
        }),
        findUnique: jest.fn(async () => ({ ...challenge })),
        updateMany: jest.fn(async ({ where, data }) => {
          if (data.attempts) {
            if (
              challenge.consumedAt ||
              !challenge.sentAt ||
              challenge.expiresAt <= new Date() ||
              challenge.attempts >= 5
            )
              return { count: 0 };
            challenge.attempts++;
          } else if (data.consumedAt) challenge.consumedAt = data.consumedAt;
          return { count: 1 };
        }),
      },
    };
    db.$transaction = jest.fn(async (fn) => fn(db));
    mail = {
      assertConfigured: jest.fn(),
      sendOtp: jest.fn(async () => undefined),
    };
    jwt = { sign: jest.fn(() => 'verified-session-token') };
    service = new StaffEmailOtpService(
      db as PrismaService,
      jwt as JwtService,
      mail as BrevoEmailService,
    );
  });
  afterEach(() => {
    delete process.env.STAFF_OTP_SECRET;
    delete process.env.STAFF_OTP_DAILY_LIMIT;
  });

  const registration = {
    citizenId: '1234567890123',
    email: 'Teacher@Example.com',
    password,
    role: Role.TEACHER,
  };
  const verify = { challengeId, code: '012345' };

  it('only sends a challenge for an existing school account; binds nothing and issues no token before OTP', async () => {
    const response = await service.requestRegistration(
      registration,
      'school-ip',
    );
    expect(response).toMatchObject({
      emailHint: 't***@example.com',
      retryAfterSeconds: 60,
    });
    expect(response).not.toHaveProperty('access_token');
    expect(response).not.toHaveProperty('code');
    const [email, code] = mail.sendOtp.mock.calls[0];
    expect(email).toBe('teacher@example.com');
    expect(code).toMatch(/^[0-9]{6}$/);
    const stored = db.staffEmailOtp.create.mock.calls[0][0].data;
    expect(stored.codeHash).toBe(mac(`${stored.id}:${code}`));
    expect(JSON.stringify(stored)).not.toContain(password);
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it.each([Role.ADMIN, Role.AFFAIRS, Role.STUDENT, Role.PARENT])(
    'cannot claim a teacher account as %s',
    async (role) => {
      await expect(
        service.requestRegistration({ ...registration, role }, 'ip'),
      ).rejects.toMatchObject({ status: 401 });
      expect(mail.sendOtp).not.toHaveBeenCalled();
    },
  );
  it('requires the existing school password, not just a known citizen ID', async () => {
    await expect(
      service.requestRegistration(
        { ...registration, password: 'chosen-by-attacker' },
        'ip',
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(mail.sendOtp).not.toHaveBeenCalled();
  });
  it('rejects an unknown staff member', async () => {
    account = null;
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('does not let registration replace an existing verified email', async () => {
    account.email = 'old@example.com';
    account.emailVerifiedAt = new Date();
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toMatchObject({ status: 409 });
    expect(mail.sendOtp).not.toHaveBeenCalled();
  });
  it('normalizes email login and requires the selected current role', async () => {
    account.email = 'teacher@example.com';
    account.emailVerifiedAt = new Date();
    await service.requestLogin(
      { email: 'Teacher@Example.com', password, role: Role.TEACHER },
      'ip',
    );
    expect(mail.sendOtp).toHaveBeenCalledWith(
      'teacher@example.com',
      expect.any(String),
      false,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('requires verified email for login', async () => {
    account.email = 'teacher@example.com';
    await expect(
      service.requestLogin(
        { email: account.email, password, role: Role.TEACHER },
        'ip',
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('binds email and signs the real role only after successful verification', async () => {
    const result = await service.verify(verify, 'ip');
    expect(account.email).toBe('teacher@example.com');
    expect(account.emailVerifiedAt).toBeInstanceOf(Date);
    expect(result.access_token).toBe('verified-session-token');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'teacher',
        role: Role.TEACHER,
        amr: ['pwd', 'email_otp'],
      }),
    );
    expect(challenge.consumedAt).toBeInstanceOf(Date);
    await expect(service.verify(verify, 'ip')).rejects.toMatchObject({
      status: 401,
    });
    expect(jwt.sign).toHaveBeenCalledTimes(1);
  });
  it('persists wrong attempts and blocks even a correct code after five failures', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        service.verify({ ...verify, code: '999999' }, 'ip'),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(challenge.attempts).toBe(5);
    await expect(service.verify(verify, 'ip')).rejects.toMatchObject({
      status: 401,
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it.each([
    'expired',
    'unsent',
    'consumed',
    'changed-role',
    'changed-password',
    'already-enrolled',
  ])('rejects %s challenge', async (state) => {
    if (state === 'expired') challenge.expiresAt = new Date(Date.now() - 1);
    if (state === 'unsent') challenge.sentAt = null;
    if (state === 'consumed') challenge.consumedAt = new Date();
    if (state === 'changed-role') account.role = Role.ADMIN;
    if (state === 'changed-password') account.password = 'changed-hash';
    if (state === 'already-enrolled') account.email = 'other@example.com';
    await expect(service.verify(verify, 'ip')).rejects.toMatchObject({
      status: 401,
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('verifies a login challenge without changing the registered email', async () => {
    account.email = challenge.email;
    account.emailVerifiedAt = new Date();
    challenge.purpose = 'LOGIN';
    await expect(service.verify(verify, 'ip')).resolves.toHaveProperty(
      'access_token',
    );
    expect(account.email).toBe(challenge.email);
  });
  it('rejects a changed email on a login challenge', async () => {
    account.email = 'changed@example.com';
    account.emailVerifiedAt = new Date();
    challenge.purpose = 'LOGIN';
    await expect(service.verify(verify, 'ip')).rejects.toMatchObject({
      status: 401,
    });
  });
  it('enforces the resend cooldown before contacting Brevo', async () => {
    db.staffEmailOtp.findFirst.mockResolvedValue(challenge);
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toMatchObject({ status: 429 });
    expect(mail.sendOtp).not.toHaveBeenCalled();
  });
  it('reserves a rolling 24-hour global send budget', async () => {
    db.staffEmailOtp.count.mockResolvedValue(280);
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toMatchObject({ status: 429 });
    expect(mail.sendOtp).not.toHaveBeenCalled();
    expect(db.staffEmailOtp.create).not.toHaveBeenCalled();
  });
  it('limits each account to ten sends per 24 hours', async () => {
    db.staffEmailOtp.count.mockResolvedValueOnce(100).mockResolvedValueOnce(10);
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toMatchObject({ status: 429 });
    expect(mail.sendOtp).not.toHaveBeenCalled();
  });
  it('invalidates uncertain provider deliveries and returns no usable challenge', async () => {
    mail.sendOtp.mockRejectedValue(new Error('synthetic-provider-failure'));
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toThrow('synthetic-provider-failure');
    expect(db.staffEmailOtp.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('does not issue a token if a concurrent password/role edit wins the CAS', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verify(verify, 'ip')).rejects.toMatchObject({
      status: 401,
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('maps a concurrent email-uniqueness conflict to a safe response', async () => {
    db.user.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2002',
        clientVersion: '7.7.0',
      }),
    );
    await expect(service.verify(verify, 'ip')).rejects.toMatchObject({
      status: 409,
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
  it('rate limits brute force before checking passwords or sending', async () => {
    db.emailOtpBucket.upsert.mockResolvedValue({ count: 2000 });
    await expect(
      service.requestRegistration(registration, 'ip'),
    ).rejects.toMatchObject({ status: 429 });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(mail.sendOtp).not.toHaveBeenCalled();
  });
});
