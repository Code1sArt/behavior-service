import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { ParentsController } from './parents/parents.controller';
import { ParentsService } from './parents/parents.service';
import { StudentsController } from './students/students.controller';
import { StudentsService } from './students/students.service';
import { SummaryController } from './summary/summary.controller';
import { SummaryService } from './summary/summary.service';
import { AttendanceController } from './attendance/attendance.controller';
import { AttendanceService } from './attendance/attendance.service';
import { BehaviorsController } from './behaviors/behaviors.controller';
import { BehaviorsService } from './behaviors/behaviors.service';
import { PrismaService } from './prisma/prisma.service';
import { StudentAccessService } from './prisma/student-access.service';

const secret = 'isolated-http-test-secret';
const jwt = new JwtService({ secret });
const users = {
  student: {
    id: 'student',
    citizenId: 's1',
    role: Role.STUDENT,
    parentId: 'parent',
  },
  other: {
    id: 'other',
    citizenId: 's2',
    role: Role.STUDENT,
    parentId: 'other-parent',
  },
  parent: { id: 'parent', citizenId: 'p1', role: Role.PARENT },
  teacher: { id: 'teacher', citizenId: 't1', role: Role.TEACHER },
  admin: { id: 'admin', citizenId: 'a1', role: Role.ADMIN },
  affairs: { id: 'affairs', citizenId: 'f1', role: Role.AFFAIRS },
};
const token = (id: string, role?: Role) =>
  jwt.sign({ sub: id, role: role ?? users[id]?.role }, { expiresIn: '1h' });
const prisma = {
  user: {
    findUnique: jest.fn(async ({ where }) => users[where.id] ?? null),
    findFirst: jest.fn(async ({ where }) => {
      const [target, scope] = where.AND;
      const student = users[target.id];
      if (!student || student.role !== Role.STUDENT) return null;
      if (scope.id) return scope.id === target.id ? { id: target.id } : null;
      if (scope.parentId)
        return student.parentId === scope.parentId ? { id: target.id } : null;
      return target.id === 'student' ? { id: target.id } : null;
    }),
  },
  classroom: {
    findFirst: jest.fn(async ({ where }) =>
      where.id === 1 ? { id: 1 } : null,
    ),
  },
};
const parents = {
  register: jest.fn(() => ({})),
  addChild: jest.fn(() => ({})),
  findAll: jest.fn(() => []),
  removeParent: jest.fn(),
  issueInvitation: jest.fn(),
};
const students = {
  create: jest.fn(),
  update: jest.fn(),
  importStudents: jest.fn(),
  search: jest.fn(() => []),
  findAll: jest.fn(() => []),
};
const summary = {
  getStudentSummary: jest.fn(() => ({})),
  getClassroomSummary: jest.fn(() => ({})),
};
const auth = { register: jest.fn(() => ({})) };
const attendance = {
  recordBulk: jest.fn(() => ({})),
  getDailyHistory: jest.fn(() => ({})),
  getDailySummary: jest.fn(() => ({})),
  sendLineNotification: jest.fn(),
};
const behaviors = {
  create: jest.fn(() => ({})),
  createBulk: jest.fn(() => ({})),
  findByStudent: jest.fn(() => []),
  getBehaviorHistory: jest.fn(() => []),
  importFromExcel: jest.fn(),
};

describe('API permissions through real HTTP + Passport JWT guards', () => {
  let app: INestApplication;
  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [
        AuthController,
        ParentsController,
        StudentsController,
        SummaryController,
        AttendanceController,
        BehaviorsController,
      ],
      providers: [
        JwtStrategy,
        StudentAccessService,
        { provide: PrismaService, useValue: prisma },
        { provide: ParentsService, useValue: parents },
        { provide: StudentsService, useValue: students },
        { provide: SummaryService, useValue: summary },
        { provide: AuthService, useValue: auth },
        { provide: AttendanceService, useValue: attendance },
        { provide: BehaviorsService, useValue: behaviors },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
    delete process.env.JWT_SECRET;
  });

  it.each([
    ['post', '/students'],
    ['patch', '/students/student'],
    ['post', '/students/upload'],
    ['get', '/students/search'],
    ['get', '/parents/all'],
    ['delete', '/parents/parent'],
    ['post', '/auth/register'],
    ['get', '/summary/student/student'],
  ])(
    'rejects unauthenticated %s %s before business logic',
    async (method, path) => {
      await request(app.getHttpServer())[method](path).send({}).expect(401);
      expect(students.create).not.toHaveBeenCalled();
      expect(parents.removeParent).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['delete', '/parents/parent'],
    ['get', '/parents/all'],
    ['post', '/auth/register'],
    ['post', '/students'],
    ['get', '/students/search'],
    ['get', '/attendance/history/daily'],
    ['get', '/attendance/summary/daily'],
    ['post', '/attendance/notify-missing'],
    ['get', '/behaviors/history'],
    ['post', '/behaviors/import-excel'],
  ])('rejects family role on staff endpoint %s %s', async (method, path) => {
    await request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token('parent')}`)
      .send({})
      .expect(403);
  });
  it.each(['summary/student', 'behaviors/student'])(
    'allows own child and rejects another family: %s',
    async (path) => {
      await request(app.getHttpServer())
        .get(`/${path}/student`)
        .set('Authorization', `Bearer ${token('parent')}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/${path}/other`)
        .set('Authorization', `Bearer ${token('parent')}`)
        .expect(403);
    },
  );
  it('restricts student history to self', async () => {
    await request(app.getHttpServer())
      .get('/summary/student/student')
      .set('Authorization', `Bearer ${token('student')}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/summary/student/other')
      .set('Authorization', `Bearer ${token('student')}`)
      .expect(403);
  });
  it('allows teacher behavior summaries throughout the school', async () => {
    await request(app.getHttpServer())
      .get('/summary/classroom/1')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/summary/classroom/2')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .expect(200);
  });
  it('validates all attendance targets before writing a mixed bulk', async () => {
    await request(app.getHttpServer())
      .post('/attendance/bulk')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .send({
        type: 'AREA',
        records: [
          { studentId: 'student', status: 'PRESENT' },
          { studentId: 'other', status: 'PRESENT' },
        ],
      })
      .expect(403);
    expect(attendance.recordBulk).not.toHaveBeenCalled();
  });
  it('does not let a teacher move an unrelated student into an advised room', async () => {
    await request(app.getHttpServer())
      .patch('/students/other')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .send({ classroomId: 1 })
      .expect(403);
    expect(students.update).not.toHaveBeenCalled();
  });
  it('does not let a teacher create a student in another advisory room', async () => {
    await request(app.getHttpServer())
      .post('/students')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .send({
        citizenId: 'test',
        firstName: 'Test',
        lastName: 'Student',
        password: 'safe-password',
        classroomId: 2,
      })
      .expect(403);
    expect(students.create).not.toHaveBeenCalled();
  });

  it('allows a teacher to read and record behavior outside the advisory room', async () => {
    await request(app.getHttpServer())
      .get('/behaviors/student/other')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/summary/student/other')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/students?classroomId=2')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/behaviors')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .send({ studentId: 'other', categoryId: 1 })
      .expect(201);
    expect(behaviors.create).toHaveBeenCalledWith(
      'teacher',
      Role.TEACHER,
      expect.objectContaining({ studentId: 'other' }),
    );
  });
  it('still forbids a teacher reading attendance in another advisory room', async () => {
    await request(app.getHttpServer())
      .get('/attendance/history/daily?classroomId=2')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .expect(403);
    expect(attendance.getDailyHistory).not.toHaveBeenCalled();
  });

  it('uses current database role instead of old ADMIN claim', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Authorization', `Bearer ${token('student', Role.ADMIN)}`)
      .send({})
      .expect(403);
    expect(auth.register).not.toHaveBeenCalled();
  });
  it('rejects a deleted account with an otherwise valid signed JWT', async () => {
    await request(app.getHttpServer())
      .get('/parents/all')
      .set('Authorization', `Bearer ${token('deleted', Role.ADMIN)}`)
      .expect(401);
  });
  it('does not silently ignore a bad optional JWT on public signup', async () => {
    await request(app.getHttpServer())
      .post('/parents/register')
      .set('Authorization', 'Bearer invalid')
      .send({})
      .expect(401);
    expect(parents.register).not.toHaveBeenCalled();
  });
  it('disables the insecure OAuth callback rather than trusting a user ID state', async () => {
    await request(app.getHttpServer())
      .get('/auth/line/callback?code=anything&state=admin')
      .expect(410);
  });
  it('still permits ADMIN to list parents and AFFAIRS to search students', async () => {
    await request(app.getHttpServer())
      .get('/parents/all')
      .set('Authorization', `Bearer ${token('admin')}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/students/search?q=demo')
      .set('Authorization', `Bearer ${token('affairs')}`)
      .expect(200);
  });
});
