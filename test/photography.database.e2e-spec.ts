import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PhotographyService } from '../src/photography/photography.service';
import { PhotographyController } from '../src/photography/photography.controller';

// This suite NEVER uses DATABASE_URL to construct its database client.
const target = process.env.PHOTOGRAPHY_TEST_DATABASE_URL;
if (!target)
  throw new Error(
    'Set PHOTOGRAPHY_TEST_DATABASE_URL to an isolated local photography_test database',
  );
const url = new URL(target);
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/photography_test' ||
  !url.port ||
  url.port === '3306'
) {
  throw new Error(
    'Only a local photography_test database on a non-default port is allowed',
  );
}
const db = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'photography_test',
    connectionLimit: 8,
  }),
});
const secret = 'photography-isolated-test-secret';
const jwt = new JwtService({ secret });
const token = (id: string, role = Role.ADMIN) => jwt.sign({ sub: id, role });
const people = [
  ['admin', Role.ADMIN],
  ['manager', Role.TEACHER],
  ['teacher', Role.TEACHER],
  ['other-teacher', Role.TEACHER],
  ['student', Role.STUDENT],
  ['other-student', Role.STUDENT],
  ['parent', Role.PARENT],
  ['affairs', Role.AFFAIRS],
] as const;
const base = {
  activityName: 'งานโรงเรียน',
  location: 'หอประชุม',
  departmentId: 'dept',
  kind: 'PHOTOGRAPHERS',
  photographerCount: 1,
  hasLunch: true,
  equipment: [],
  slots: [
    {
      startsAt: '2099-01-02T09:00:00+07:00',
      endsAt: '2099-01-02T12:00:00+07:00',
    },
    {
      startsAt: '2099-01-04T09:00:00+07:00',
      endsAt: '2099-01-04T12:00:00+07:00',
    },
  ],
};

describe('Photography HTTP workflow with real isolated MySQL transactions', () => {
  let app: INestApplication;
  const saved = { ...process.env };
  const api = (id: string) => ({
    get: (path: string) =>
      request(app.getHttpServer() as Server)
        .get(`/photography/${path}`)
        .set('Authorization', `Bearer ${token(id)}`),
    delete: (path: string) =>
      request(app.getHttpServer() as Server)
        .delete(`/photography/${path}`)
        .set('Authorization', `Bearer ${token(id)}`),
    post: (path: string, data: unknown) =>
      request(app.getHttpServer() as Server)
        .post(`/photography/${path}`)
        .set('Authorization', `Bearer ${token(id)}`)
        .send(data),
    patch: (path: string, data: unknown) =>
      request(app.getHttpServer() as Server)
        .patch(`/photography/${path}`)
        .set('Authorization', `Bearer ${token(id)}`)
        .send(data),
  });
  async function create(overrides: Record<string, unknown> = {}) {
    const res = await api('teacher')
      .post('bookings', { ...base, ...overrides })
      .expect(201);
    return (res.body as { id: string }).id;
  }
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    process.env.PHOTOGRAPHY_ENABLED = 'true';
    process.env.IN_APP_NOTIFICATIONS_ENABLED = 'true';
    process.env.PUSH_ENABLED = 'true';
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PhotographyController],
      providers: [
        JwtStrategy,
        PhotographyService,
        NotificationsService,
        { provide: PrismaService, useValue: db },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  beforeEach(async () => {
    await db.photographyLineDelivery.deleteMany();
    await db.notificationInbox.deleteMany();
    await db.pushDelivery.deleteMany();
    await db.notificationDevice.deleteMany();
    await db.photographyBooking.deleteMany();
    await db.photographer.deleteMany();
    await db.photographyManager.deleteMany();
    await db.photographyEquipment.deleteMany();
    await db.photographyDepartment.deleteMany();
    await db.user.deleteMany();
    await db.user.createMany({
      data: people.map(([id, role]) => ({
        id,
        role,
        citizenId: `test-${id}`,
        firstName: id,
        lastName: 'ทดสอบ',
        password: 'test-only-unused',
        lineUserId: `line-${id}`,
      })),
    });
    await db.photographyManager.create({ data: { userId: 'manager' } });
    await db.photographer.createMany({
      data: [{ userId: 'student' }, { userId: 'other-student' }],
    });
    await db.photographyDepartment.create({
      data: { id: 'dept', name: 'กลุ่มงานทดสอบ' },
    });
    await db.photographyEquipment.create({
      data: { id: 'camera', name: 'กล้อง', quantity: 2 },
    });
    await db.notificationDevice.create({
      data: {
        id: 'device',
        tokenHash: 'a'.repeat(64),
        token: 'fake-never-sent',
        userId: 'student',
        platform: 'ios',
        sessionExpiresAt: new Date('2099-01-01'),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
    for (const key of [
      'JWT_SECRET',
      'PHOTOGRAPHY_ENABLED',
      'IN_APP_NOTIFICATIONS_ENABLED',
      'PUSH_ENABLED',
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('requires login and refuses parents, forged ADMIN claims and non-manager staff', async () => {
    await request(app.getHttpServer() as Server)
      .get('/photography/metadata')
      .expect(401);
    await api('parent').get('metadata').expect(403);
    await api('teacher')
      .patch('managers/other-teacher', { active: true })
      .expect(403);
    await api('teacher')
      .patch('photographers/student', { active: false })
      .expect(403);
    await api('student').post('bookings', base).expect(403);
    await api('teacher').get('directory?role=TEACHER&q=te').expect(403);
    await api('manager').get('managers').expect(403);
  });
  it('admin designates only teachers; managers add only students; revocation takes effect immediately', async () => {
    await api('admin').patch('managers/student', { active: true }).expect(400);
    await api('admin')
      .patch('managers/other-teacher', { active: true })
      .expect(200);
    await api('other-teacher')
      .patch('photographers/teacher', { active: true })
      .expect(400);
    await api('other-teacher')
      .patch('photographers/student', { active: false })
      .expect(200);
    await api('admin')
      .patch('managers/other-teacher', { active: false })
      .expect(200);
    await api('other-teacher')
      .patch('photographers/student', { active: true })
      .expect(403);
  });
  it('creates multiple days with authenticated requester, safe person fields, and notifies managers', async () => {
    const id = await create({ requesterId: 'admin' });
    const detail = await api('teacher').get(`bookings/${id}`).expect(200);
    expect((detail.body as { requester: { id: string } }).requester.id).toBe(
      'teacher',
    );
    expect((detail.body as { requester: object }).requester).not.toHaveProperty(
      'password',
    );
    expect((detail.body as { slots: object[] }).slots).toHaveLength(2);
    expect(
      (detail.body as { slots: { startsAt: string }[] }).slots[0].startsAt,
    ).toBe('2099-01-02T02:00:00.000Z');
    expect(
      await db.notificationInbox.count({
        where: { userId: 'manager', kind: 'photography' },
      }),
    ).toBe(1);
    const bookings = await api('other-teacher').get('bookings').expect(200);
    expect((bookings.body as { total: number }).total).toBe(0);
    await api('other-teacher').get(`bookings/${id}`).expect(404);
    await api('student').get(`bookings/${id}`).expect(404);
  });
  it('rejects nested malformed ranges, overlapping ranges, duplicates and mixed equipment/photographer modes', async () => {
    await api('teacher')
      .post('bookings', { ...base, slots: [{ startsAt: 'bad' }] })
      .expect(400);
    await api('teacher')
      .post('bookings', { ...base, slots: [base.slots[0], base.slots[0]] })
      .expect(400);
    await api('teacher')
      .post('bookings', {
        ...base,
        slots: [
          { startsAt: '2099-01-02T09:00:00', endsAt: '2099-01-02T12:00:00' },
        ],
      })
      .expect(400);
    await api('teacher')
      .post('bookings', {
        ...base,
        equipment: [{ equipmentId: 'camera', quantity: 1 }],
      })
      .expect(400);
    await api('teacher')
      .post('bookings', {
        ...base,
        kind: 'EQUIPMENT',
        photographerCount: 0,
        equipment: [
          { equipmentId: 'camera', quantity: 1 },
          { equipmentId: 'camera', quantity: 1 },
        ],
      })
      .expect(400);
    await api('teacher').get('bookings?page=0').expect(400);
    expect(await db.photographyBooking.count()).toBe(0);
  });
  it('approval assigns exactly the requested number and commits student inbox, push and LINE outbox', async () => {
    const id = await create();
    await api('manager')
      .post(`bookings/${id}/approve`, { studentIds: [] })
      .expect(400);
    await api('teacher')
      .post(`bookings/${id}/approve`, { studentIds: ['student'] })
      .expect(403);
    await api('manager')
      .post(`bookings/${id}/approve`, { studentIds: ['student'] })
      .expect(201);
    await api('student').get(`bookings/${id}`).expect(200);
    await api('other-student').get(`bookings/${id}`).expect(404);
    const events = await db.notificationInbox.findMany({
      where: { userId: 'student' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toMatch(new RegExp(`^photography:${id}:`));
    expect(events[0].body).toContain('หอประชุม');
    expect(
      await db.pushDelivery.count({
        where: { userId: 'student', kind: 'photography' },
      }),
    ).toBe(1);
    expect(
      await db.photographyLineDelivery.count({ where: { userId: 'student' } }),
    ).toBe(1);
    await api('manager')
      .post(`bookings/${id}/approve`, { studentIds: ['student'] })
      .expect(409);
    expect(
      await db.notificationInbox.count({ where: { userId: 'student' } }),
    ).toBe(1);
  });
  it('concurrent approvals cannot double-book a photographer across API processes', async () => {
    const a = await create(),
      b = await create();
    const responses = await Promise.all(
      [a, b].map((id) =>
        api('manager').post(`bookings/${id}/approve`, {
          studentIds: ['student'],
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.photographyAssignment.count({ where: { studentId: 'student' } }),
    ).toBe(1);
    expect(
      await db.notificationInbox.count({ where: { userId: 'student' } }),
    ).toBe(1);
    const loser = responses[0].status === 409 ? a : b;
    const availability = await api('manager')
      .get(`bookings/${loser}/availability`)
      .expect(200);
    expect(
      (availability.body as { userId: string; busy: boolean }[]).find(
        (r) => r.userId === 'student',
      )?.busy,
    ).toBe(true);
    await api('teacher').get(`bookings/${loser}/availability`).expect(403);
  });
  it('concurrent approvals cannot over-allocate equipment and need no student assignment', async () => {
    const payload = {
      kind: 'EQUIPMENT',
      photographerCount: 0,
      equipment: [{ equipmentId: 'camera', quantity: 2 }],
    };
    const a = await create(payload),
      b = await create(payload);
    const responses = await Promise.all(
      [a, b].map((id) =>
        api('manager').post(`bookings/${id}/approve`, { studentIds: [] }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.photographyAssignment.count()).toBe(0);
    const winner = responses[0].status === 201 ? a : b;
    await api('manager')
      .post('equipment', { name: 'กล้อง', quantity: 1 })
      .expect(409);
    await api('teacher')
      .post(`bookings/${winner}/cancel`, { note: 'เลื่อนกิจกรรม' })
      .expect(201);
    const loser = winner === a ? b : a;
    await api('manager')
      .post(`bookings/${loser}/approve`, { studentIds: [] })
      .expect(201);
  });
  it('permits adjacent assignments and does not reserve gaps between requested days', async () => {
    const first = await create();
    await api('manager')
      .post(`bookings/${first}/approve`, { studentIds: ['student'] })
      .expect(201);
    for (const startsAt of [
      '2099-01-02T12:00:00+07:00',
      '2099-01-03T09:00:00+07:00',
    ]) {
      const end = new Date(
        new Date(startsAt).getTime() + 3600000,
      ).toISOString();
      const id = await create({ slots: [{ startsAt, endsAt: end }] });
      await api('manager')
        .post(`bookings/${id}/approve`, { studentIds: ['student'] })
        .expect(201);
    }
  });
  it('cancelling frees availability, preserves assignment history and notifies the assigned student', async () => {
    const a = await create(),
      b = await create();
    await api('manager')
      .post(`bookings/${a}/approve`, { studentIds: ['student'] })
      .expect(201);
    await api('other-teacher')
      .post(`bookings/${a}/cancel`, { note: 'unauthorized' })
      .expect(404);
    await api('student')
      .post(`bookings/${a}/cancel`, { note: 'unauthorized' })
      .expect(404);
    await api('teacher')
      .post(`bookings/${a}/cancel`, { note: 'เลื่อนกิจกรรม' })
      .expect(201);
    const previous = await api('student').get(`bookings/${a}`).expect(200);
    expect((previous.body as { status: string }).status).toBe('CANCELLED');
    expect(
      await db.notificationInbox.count({ where: { userId: 'student' } }),
    ).toBe(2);
    await api('manager')
      .post(`bookings/${b}/approve`, { studentIds: ['student'] })
      .expect(201);
  });
  it('inactive roster and equipment are refused; rejection is final and notifies requester', async () => {
    const id = await create();
    await api('manager')
      .patch('photographers/student', { active: false })
      .expect(200);
    await api('manager')
      .post(`bookings/${id}/approve`, { studentIds: ['student'] })
      .expect(400);
    await api('manager')
      .post(`bookings/${id}/reject`, { note: '   ' })
      .expect(400);
    await api('manager')
      .post(`bookings/${id}/reject`, { note: 'ทีมไม่พร้อม' })
      .expect(201);
    await api('manager')
      .post(`bookings/${id}/approve`, { studentIds: ['other-student'] })
      .expect(409);
    const equipment = await create({
      kind: 'EQUIPMENT',
      photographerCount: 0,
      equipment: [{ equipmentId: 'camera', quantity: 1 }],
    });
    await api('manager')
      .patch('equipment/camera', { active: false })
      .expect(200);
    await api('manager')
      .post(`bookings/${equipment}/approve`, { studentIds: [] })
      .expect(409);
    expect(
      await db.notificationInbox.count({ where: { userId: 'teacher' } }),
    ).toBe(1);
  });
  it.each(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])(
    'admin permanently deletes a %s booking, its resources and notifications only',
    async (status) => {
      const id = await create();
      const other = await create();
      if (status === 'APPROVED') {
        await api('manager')
          .post(`bookings/${id}/approve`, { studentIds: ['student'] })
          .expect(201);
        // Deletion remains available after the job has begun.
        await db.photographyBookingSlot.updateMany({
          where: { bookingId: id },
          data: { startsAt: new Date('2020-01-01') },
        });
      } else if (status === 'REJECTED') {
        await api('manager')
          .post(`bookings/${id}/reject`, { note: 'ทีมไม่พร้อม' })
          .expect(201);
      } else if (status === 'CANCELLED') {
        await api('teacher')
          .post(`bookings/${id}/cancel`, { note: 'เลื่อนกิจกรรม' })
          .expect(201);
      }
      for (const user of [
        'teacher',
        'other-teacher',
        'manager',
        'affairs',
        'student',
        'parent',
      ]) {
        await api(user).delete(`bookings/${id}`).expect(403);
      }
      await api('admin')
        .delete(`bookings/${id}`)
        .expect(200, { deleted: true, id });
      await api('admin').get(`bookings/${id}`).expect(404);
      await api('admin').delete(`bookings/${id}`).expect(404);
      expect(
        await db.photographyBookingSlot.count({ where: { bookingId: id } }),
      ).toBe(0);
      expect(
        await db.photographyAssignment.count({ where: { bookingId: id } }),
      ).toBe(0);
      const eventId = { startsWith: `photography:${id}:` };
      expect(await db.notificationInbox.count({ where: { eventId } })).toBe(0);
      expect(await db.pushDelivery.count({ where: { eventId } })).toBe(0);
      expect(
        await db.photographyLineDelivery.count({ where: { eventId } }),
      ).toBe(0);
      await api('admin').get(`bookings/${other}`).expect(200);
      expect(
        await db.notificationInbox.count({
          where: { eventId: { startsWith: `photography:${other}:` } },
        }),
      ).toBeGreaterThan(0);
      if (status === 'APPROVED') {
        await api('manager')
          .post(`bookings/${other}/approve`, { studentIds: ['student'] })
          .expect(201);
      }
    },
  );
  it('deleting an approved equipment booking releases stock and removes reservation rows', async () => {
    const equipment = {
      kind: 'EQUIPMENT',
      photographerCount: 0,
      equipment: [{ equipmentId: 'camera', quantity: 2 }],
    };
    const a = await create(equipment),
      b = await create(equipment);
    await api('manager')
      .post(`bookings/${a}/approve`, { studentIds: [] })
      .expect(201);
    await api('manager')
      .post(`bookings/${b}/approve`, { studentIds: [] })
      .expect(409);
    await api('admin').delete(`bookings/${a}`).expect(200);
    expect(
      await db.photographyBookingEquipment.count({ where: { bookingId: a } }),
    ).toBe(0);
    await api('manager')
      .post(`bookings/${b}/approve`, { studentIds: [] })
      .expect(201);
  });
  it('rolls back deletion and notification cleanup together if the final delete fails', async () => {
    const id = await create();
    // Inject a late error inside the real transaction, after notification cleanup.
    const service = app.get(PrismaService);
    const transaction = service.$transaction.bind(service) as (
      action: (tx: Prisma.TransactionClient) => Promise<unknown>,
      options?: unknown,
    ) => Promise<unknown>;
    const spy = jest.spyOn(service, '$transaction').mockImplementationOnce(
      (action: unknown, options: unknown) =>
        transaction(async (tx) => {
          const proxy = new Proxy(tx, {
            get(target, property) {
              if (property === 'photographyBooking')
                return {
                  ...target.photographyBooking,
                  delete: () => {
                    throw new Error('injected delete failure');
                  },
                };
              return Reflect.get(target, property) as unknown;
            },
          });
          return (action as (db: Prisma.TransactionClient) => Promise<unknown>)(
            proxy,
          );
        }, options) as never,
    );
    try {
      await api('admin').delete(`bookings/${id}`).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db.photographyBooking.findUnique({ where: { id } }),
    ).not.toBeNull();
    expect(
      await db.photographyBookingSlot.count({ where: { bookingId: id } }),
    ).toBe(2);
    expect(
      await db.notificationInbox.count({
        where: { eventId: { startsWith: `photography:${id}:` } },
      }),
    ).toBeGreaterThan(0);
  });
  it('an outbox write failure rolls back approval and assignment together', async () => {
    const id = await create();
    // Force a DB rejection only for this request's notification write.
    const service = app.get(NotificationsService);
    const spy = jest
      .spyOn(service, 'enqueueUsers')
      .mockRejectedValueOnce(new Error('injected outbox failure'));
    await api('manager')
      .post(`bookings/${id}/approve`, { studentIds: ['student'] })
      .expect(500);
    spy.mockRestore();
    expect(
      (await db.photographyBooking.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('PENDING');
    expect(await db.photographyAssignment.count()).toBe(0);
    expect(
      await db.notificationInbox.count({ where: { userId: 'student' } }),
    ).toBe(0);
  });
});
