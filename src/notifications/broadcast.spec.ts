import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { SendBroadcastDto } from './broadcast.dto';

const secret = 'broadcast-http-isolated-test';
const jwt = new JwtService({ secret });
const teacherId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000002';
const draft: SendBroadcastDto = {
  requestId: '00000000-0000-4000-8000-000000000003',
  audience: 'TEACHERS',
  scope: 'ALL',
  userIds: [],
  classroomIds: [],
  title: 'ประกาศโรงเรียน',
  body: 'รายละเอียดประกาศ',
  recipientCount: 1,
};
const token = (role: Role) => jwt.sign({ sub: role }, { expiresIn: '1h' });
type AuthLookup = { where: { id: string } };
type InboxBatch = { data: { userId: string }[] };
const prisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  classroom: { count: jest.fn(), findMany: jest.fn() },
  notificationInbox: {
    createMany: jest.fn<Promise<{ count: number }>, [InboxBatch]>(),
  },
  notificationDevice: { findMany: jest.fn() },
  pushDelivery: { createMany: jest.fn() },
  $transaction: jest.fn(),
};

describe('admin broadcast HTTP targeting and delivery', () => {
  let app: INestApplication;
  let server: Server;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [BroadcastController],
      providers: [
        BroadcastService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    server = app.getHttpServer() as Server;
  });
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.IN_APP_NOTIFICATIONS_ENABLED = 'true';
    process.env.PUSH_ENABLED = 'true';
    prisma.user.findUnique.mockImplementation(({ where }: AuthLookup) =>
      Promise.resolve({
        id: where.id,
        role: where.id,
        citizenId: 'test',
      }),
    );
    prisma.user.findMany.mockResolvedValue([{ id: teacherId }]);
    prisma.classroom.count.mockResolvedValue(1);
    prisma.classroom.findMany.mockResolvedValue([{ id: 1, name: 'ม.1/1' }]);
    prisma.notificationInbox.createMany.mockResolvedValue({ count: 1 });
    prisma.notificationDevice.findMany.mockResolvedValue([
      { id: 'device', userId: teacherId, revision: 3 },
    ]);
    prisma.pushDelivery.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
  });
  afterAll(async () => {
    await app.close();
    for (const key of [
      'JWT_SECRET',
      'IN_APP_NOTIFICATIONS_ENABLED',
      'PUSH_ENABLED',
    ]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  });

  it('requires a JWT', async () => {
    await request(server)
      .post('/notifications/broadcasts')
      .send(draft)
      .expect(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([Role.TEACHER, Role.STUDENT, Role.PARENT, Role.AFFAIRS])(
    'blocks %s from all broadcast endpoints',
    async (role) => {
      const auth = `Bearer ${token(role)}`;
      await request(server)
        .get('/notifications/broadcasts/options')
        .set('Authorization', auth)
        .expect(403);
      await request(server)
        .post('/notifications/broadcasts/preview')
        .set('Authorization', auth)
        .send(draft)
        .expect(403);
      await request(server)
        .post('/notifications/broadcasts')
        .set('Authorization', auth)
        .send(draft)
        .expect(403);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('limits picker data to teachers and students/classrooms in the current term', async () => {
    await request(server)
      .get('/notifications/broadcasts/options')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .expect(200);
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { role: Role.TEACHER } }),
    );
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { role: Role.STUDENT, classroom: { term: { isActive: true } } },
      }),
    );
    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { term: { isActive: true } } }),
    );
  });

  it('previews selected students using their role and IDs', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: studentId }]);
    const response = await request(server)
      .post('/notifications/broadcasts/preview')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({
        ...draft,
        audience: 'STUDENTS',
        scope: 'SELECTED',
        userIds: [studentId],
      })
      .expect(201);
    expect((response.body as { recipientCount: number }).recipientCount).toBe(
      1,
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        role: Role.STUDENT,
        classroom: { term: { isActive: true } },
        id: { in: [studentId] },
      },
      select: { id: true },
    });
    expect(prisma.notificationInbox.createMany).not.toHaveBeenCalled();
  });

  it('sends only to students in selected current classrooms', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: studentId }]);
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({
        ...draft,
        audience: 'CLASSROOMS',
        scope: 'SELECTED',
        classroomIds: [1],
      })
      .expect(201);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        role: Role.STUDENT,
        classroom: { term: { isActive: true } },
        classroomId: { in: [1] },
      },
      select: { id: true },
    });
    expect(prisma.notificationInbox.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: studentId,
          kind: 'broadcast',
          title: draft.title,
          body: draft.body,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('atomically saves inbox entries and queues only unexpired devices', async () => {
    const response = await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({ ...draft, title: `  ${draft.title}  ` })
      .expect(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        recipientCount: 1,
        inboxCount: 1,
        queuedDeviceCount: 1,
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.notificationDevice.findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: [teacherId] },
        sessionExpiresAt: { gt: expect.any(Date) as Date },
      },
      select: { id: true, userId: true, revision: true },
    });
    expect(prisma.pushDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventId: (response.body as { eventId: string }).eventId,
          deviceId: 'device',
          deviceRevision: 3,
          title: draft.title,
          body: draft.body,
          kind: 'broadcast',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('reuses event keys on retry and isolates a new draft', async () => {
    const service = app.get(BroadcastService);
    const first = await service.send('admin', draft);
    prisma.notificationInbox.createMany.mockResolvedValue({ count: 0 });
    prisma.pushDelivery.createMany.mockResolvedValue({ count: 0 });
    const retry = await service.send('admin', draft);
    const changed = await service.send('admin', {
      ...draft,
      body: 'ประกาศใหม่',
    });
    expect(retry.eventId).toBe(first.eventId);
    expect(retry.inboxCount).toBe(0);
    expect(retry.queuedDeviceCount).toBe(0);
    expect(changed.eventId).not.toBe(first.eventId);
  });

  it('preserves inbox delivery when Push is disabled', async () => {
    process.env.PUSH_ENABLED = 'false';
    const response = await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send(draft)
      .expect(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        inboxCount: 1,
        queuedDeviceCount: 0,
        pushEnabled: false,
      }),
    );
    expect(prisma.notificationDevice.findMany).not.toHaveBeenCalled();
  });

  it('keeps full announcement text in the inbox and bounds multibyte Push text', async () => {
    const body = '📣'.repeat(1000);
    await app.get(BroadcastService).send('admin', { ...draft, body });
    expect(prisma.notificationInbox.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ body })],
      skipDuplicates: true,
    });
    expect(prisma.pushDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ body: `${'📣'.repeat(250)}…` })],
      skipDuplicates: true,
    });
  });

  it('rejects changed recipient counts before any writes', async () => {
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({ ...draft, recipientCount: 2 })
      .expect(409);
    expect(prisma.notificationInbox.createMany).not.toHaveBeenCalled();
  });

  it.each([
    { audience: 'PARENTS' },
    { title: '   ' },
    { body: '' },
    { title: 'x'.repeat(121) },
    { body: 'x'.repeat(1001) },
    { requestId: 'bad' },
    { userIds: undefined },
    { scope: 'SELECTED', userIds: [] },
    { userIds: [teacherId] },
    { audience: 'CLASSROOMS', scope: 'ALL', classroomIds: [1] },
    { classroomIds: ['1'] },
    { classroomIds: [0] },
    { userIds: [teacherId, teacherId] },
  ])('rejects invalid input %j', async (invalid) => {
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({ ...draft, ...invalid })
      .expect(400);
    expect(prisma.notificationInbox.createMany).not.toHaveBeenCalled();
  });

  it('rejects selected accounts outside the requested role', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({ ...draft, scope: 'SELECTED', userIds: [studentId] })
      .expect(400);
    expect(prisma.notificationInbox.createMany).not.toHaveBeenCalled();
  });

  it('rejects stale classrooms and empty audiences', async () => {
    prisma.classroom.count.mockResolvedValue(0);
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send({
        ...draft,
        audience: 'CLASSROOMS',
        scope: 'SELECTED',
        classroomIds: [99],
      })
      .expect(400);
    prisma.user.findMany.mockResolvedValue([]);
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send(draft)
      .expect(400);
    expect(prisma.notificationInbox.createMany).not.toHaveBeenCalled();
  });

  it('batches large audiences without losing recipients', async () => {
    prisma.user.findMany.mockResolvedValue(
      Array.from({ length: 1201 }, (_, i) => ({ id: `student-${i}` })),
    );
    prisma.notificationInbox.createMany.mockImplementation(({ data }) =>
      Promise.resolve({ count: data.length }),
    );
    process.env.PUSH_ENABLED = 'false';
    const result = await app
      .get(BroadcastService)
      .send('admin', { ...draft, recipientCount: 1201 });
    expect(result.inboxCount).toBe(1201);
    expect(
      prisma.notificationInbox.createMany.mock.calls.map(
        ([arg]) => arg.data.length,
      ),
    ).toEqual([500, 500, 201]);
  });

  it('requires inbox enablement before sending', async () => {
    delete process.env.IN_APP_NOTIFICATIONS_ENABLED;
    await request(server)
      .post('/notifications/broadcasts')
      .set('Authorization', `Bearer ${token(Role.ADMIN)}`)
      .send(draft)
      .expect(503);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
