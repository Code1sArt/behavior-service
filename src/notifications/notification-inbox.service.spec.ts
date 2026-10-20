import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { NotificationInboxService } from './notification-inbox.service';
import { NotificationInboxController } from './notification-inbox.controller';

const secret = 'inbox-http-isolated-test';
const jwt = new JwtService({ secret });
const token = (sub: string) => jwt.sign({ sub }, { expiresIn: '1h' });
const prisma = {
  user: {
    findUnique: jest.fn(async ({ where }) => ({
      id: where.id,
      role: 'PARENT',
      citizenId: 'test',
    })),
  },
  notificationInbox: {
    findFirst: jest.fn(async ({ where }) =>
      where.id === 'mine' && where.userId === 'parent' ? { id: 'mine' } : null,
    ),
    findMany: jest.fn(async () => [
      {
        id: 'mine',
        kind: 'behavior',
        eventId: 'event',
        createdAt: new Date(),
        readAt: null,
      },
    ]),
    count: jest.fn(async () => 3),
    updateMany: jest.fn(async () => ({ count: 1 })),
  },
};

describe('notification inbox HTTP ownership and unread state', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [NotificationInboxController],
      providers: [
        NotificationInboxService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.IN_APP_NOTIFICATIONS_ENABLED = 'true';
  });
  afterEach(() => delete process.env.IN_APP_NOTIFICATIONS_ENABLED);
  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });
  it.each([
    ['get', '/notifications/inbox'],
    ['get', '/notifications/inbox/unread-count'],
    ['patch', '/notifications/inbox/mine/read'],
  ])('requires JWT for %s %s', async (method, path) => {
    await request(app.getHttpServer())[method](path).expect(401);
  });
  it('returns a true per-user unread count', async () => {
    const response = await request(app.getHttpServer())
      .get('/notifications/inbox/unread-count')
      .set('Authorization', `Bearer ${token('parent')}`)
      .expect(200);
    expect(response.body.unreadCount).toBe(3);
    expect(prisma.notificationInbox.count).toHaveBeenCalledWith({
      where: { userId: 'parent', readAt: null },
    });
  });
  it('does not return another account unread count from a query parameter', async () => {
    await request(app.getHttpServer())
      .get('/notifications/inbox?userId=other')
      .set('Authorization', `Bearer ${token('parent')}`)
      .expect(200);
    expect(prisma.notificationInbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'parent' }),
      }),
    );
  });
  it('does not mark another user item read', async () => {
    await request(app.getHttpServer())
      .patch('/notifications/inbox/foreign/read')
      .set('Authorization', `Bearer ${token('parent')}`)
      .expect(404);
    expect(prisma.notificationInbox.updateMany).not.toHaveBeenCalled();
  });
  it('marks the owned item read without trusting a supplied owner', async () => {
    await request(app.getHttpServer())
      .patch('/notifications/inbox/mine/read')
      .set('Authorization', `Bearer ${token('parent')}`)
      .send({ userId: 'other' })
      .expect(200);
    expect(prisma.notificationInbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'mine', userId: 'parent', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
  it('rejects pagination from another account', async () => {
    await request(app.getHttpServer())
      .get('/notifications/inbox?cursor=foreign')
      .set('Authorization', `Bearer ${token('parent')}`)
      .expect(404);
    expect(prisma.notificationInbox.findMany).not.toHaveBeenCalled();
  });
  it('does not mark newly arriving messages read beyond the displayed snapshot', async () => {
    const until = '2026-01-01T00:00:00.000Z';
    await request(app.getHttpServer())
      .patch('/notifications/inbox/read-all')
      .set('Authorization', `Bearer ${token('parent')}`)
      .send({ until })
      .expect(200);
    expect(prisma.notificationInbox.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'parent',
        readAt: null,
        createdAt: { lte: new Date(until) },
      },
      data: { readAt: expect.any(Date) },
    });
  });
  it('requires a valid read-all cutoff', async () => {
    await request(app.getHttpServer())
      .patch('/notifications/inbox/read-all')
      .set('Authorization', `Bearer ${token('parent')}`)
      .send({ until: 'invalid' })
      .expect(400);
    expect(prisma.notificationInbox.updateMany).not.toHaveBeenCalled();
  });
  it('opening an OS push marks only this users matching event read', async () => {
    await request(app.getHttpServer())
      .patch('/notifications/inbox/read-event')
      .set('Authorization', `Bearer ${token('parent')}`)
      .send({ eventId: 'event', userId: 'other' })
      .expect(200);
    expect(prisma.notificationInbox.updateMany).toHaveBeenCalledWith({
      where: { userId: 'parent', eventId: 'event', readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
  it('is gated until the migration is deployed', async () => {
    delete process.env.IN_APP_NOTIFICATIONS_ENABLED;
    await request(app.getHttpServer())
      .get('/notifications/inbox/unread-count')
      .set('Authorization', `Bearer ${token('parent')}`)
      .expect(503);
    expect(prisma.notificationInbox.count).not.toHaveBeenCalled();
  });
});
