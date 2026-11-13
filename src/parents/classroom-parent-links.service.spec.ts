import { createHash } from 'node:crypto';
import { Role } from '@prisma/client';
import {
  ClassroomParentLinksService,
  generateClassroomCode,
} from './classroom-parent-links.service';
import { PrismaService } from '../prisma/prisma.service';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const parent = { userId: 'parent', role: Role.PARENT };
const code = 'aB3xY';
const selections = [
  { studentId: 's1', invitationCode: code },
  { studentId: 's2', invitationCode: code },
];

describe('shared classroom parent invitations', () => {
  const prisma = {
    classroom: { findUnique: jest.fn() },
    parentClassroomInvitation: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    user: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new ClassroomParentLinksService(
    prisma as unknown as PrismaService,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(prisma));
    prisma.classroom.findUnique.mockResolvedValue({ id: 1, name: 'ม.1/1' });
    prisma.parentClassroomInvitation.findUnique.mockResolvedValue({
      classroomId: 1,
      classroom: { id: 1, name: 'ม.1/1' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.parentClassroomInvitation.findMany.mockResolvedValue([
      { tokenHash: hash(code), classroomId: 1 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 's1', classroomId: 1 },
      { id: 's2', classroomId: 1 },
    ]);
    prisma.user.findUnique.mockResolvedValue({ role: Role.PARENT });
    prisma.user.updateMany.mockResolvedValue({ count: 2 });
  });

  it('generates exactly five case-sensitive alphanumeric characters with all three character groups', () => {
    for (let i = 0; i < 500; i++) {
      const generated = generateClassroomCode();
      expect(generated).toMatch(/^[a-zA-Z0-9]{5}$/);
      expect(generated).toMatch(/[a-z]/);
      expect(generated).toMatch(/[A-Z]/);
      expect(generated).toMatch(/[0-9]/);
    }
  });
  it('stores a single hashed code per classroom, rotates it and retries a collision', async () => {
    prisma.parentClassroomInvitation.upsert
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValue({});
    const before = Date.now();
    const result = await service.issue(1, {
      userId: 'staff',
      role: Role.AFFAIRS,
    });
    expect(prisma.parentClassroomInvitation.upsert).toHaveBeenCalledTimes(2);
    const query = prisma.parentClassroomInvitation.upsert.mock.calls[1][0];
    expect(query.where).toEqual({ classroomId: 1 });
    expect(query.create.tokenHash).toBe(hash(result.invitationCode));
    expect(query.update.tokenHash).toBe(query.create.tokenHash);
    expect(query.create).not.toHaveProperty('invitationCode');
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 14 * 24 * 60 * 60 * 1000,
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    );
    expect(query.create.expiresAt).toEqual(result.expiresAt);
    expect(query.update.expiresAt).toEqual(result.expiresAt);
  });
  it('does not allow a parent to issue codes', async () => {
    await expect(service.issue(1, parent)).rejects.toThrow();
    expect(prisma.parentClassroomInvitation.upsert).not.toHaveBeenCalled();
  });
  it('resolves the same shared code repeatedly and only lists unlinked students in its room', async () => {
    await service.resolve(code);
    await service.resolve(code);
    expect(prisma.parentClassroomInvitation.findUnique).toHaveBeenCalledTimes(
      2,
    );
    expect(prisma.parentClassroomInvitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hash(code) } }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: Role.STUDENT, classroomId: 1, parentId: null },
        select: { id: true, firstName: true, lastName: true },
      }),
    );
    await service.resolve(code.toLowerCase());
    expect(
      prisma.parentClassroomInvitation.findUnique.mock.calls[2][0].where
        .tokenHash,
    ).not.toBe(hash(code));
  });
  it.each([null, { expiresAt: new Date(0) }])(
    'rejects unknown and expired codes before listing names',
    async (invitation) => {
      prisma.parentClassroomInvitation.findUnique.mockResolvedValue(invitation);
      await expect(service.resolve(code)).rejects.toThrow('รหัสห้อง');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    },
  );
  it('links several selected students atomically without consuming the room code', async () => {
    await expect(
      service.addChildren(parent, selections),
    ).resolves.toMatchObject({ count: 2 });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        role: Role.STUDENT,
        parentId: null,
        OR: [
          { id: 's1', classroomId: 1 },
          { id: 's2', classroomId: 1 },
        ],
      },
      data: { parentId: 'parent' },
    });
    expect(prisma.parentClassroomInvitation.upsert).not.toHaveBeenCalled();
  });
  it('lets a teacher link children to the same signed-in account', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: Role.TEACHER });
    await expect(
      service.addChildren(
        { userId: 'teacher', role: Role.TEACHER },
        selections,
      ),
    ).resolves.toMatchObject({ count: 2 });
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { parentId: 'teacher' } }),
    );
  });
  it('lets another parent use the same room code for a different unlinked student', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 's1', classroomId: 1 }])
      .mockResolvedValueOnce([{ id: 's2', classroomId: 1 }]);
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await service.addChildren(parent, [selections[0]]);
    await service.addChildren({ userId: 'second-parent', role: Role.PARENT }, [
      selections[1],
    ]);
    expect(
      prisma.user.updateMany.mock.calls.map((call) => call[0].data.parentId),
    ).toEqual(['parent', 'second-parent']);
    expect(prisma.parentClassroomInvitation.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.parentClassroomInvitation.upsert).not.toHaveBeenCalled();
  });
  it("accepts several rooms only when every selected student has that room's code", async () => {
    prisma.parentClassroomInvitation.findMany.mockResolvedValue([
      { tokenHash: hash(code), classroomId: 1 },
      { tokenHash: hash('xY7zQ'), classroomId: 2 },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 's1', classroomId: 1 },
      { id: 's2', classroomId: 2 },
    ]);
    await expect(
      service.addChildren(parent, [
        selections[0],
        { studentId: 's2', invitationCode: 'xY7zQ' },
      ]),
    ).resolves.toMatchObject({ count: 2 });
  });
  it.each([
    {
      students: [
        { id: 's1', classroomId: 1 },
        { id: 's2', classroomId: 2 },
      ],
    },
    { students: [{ id: 's1', classroomId: 1 }] },
  ])(
    'rejects a different classroom or already-linked student without changing any links',
    async ({ students }) => {
      prisma.user.findMany.mockResolvedValue(students);
      await expect(service.addChildren(parent, selections)).rejects.toThrow(
        'นักเรียน',
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    },
  );
  it('rejects expired or rotated proof at submission even if the roster was loaded earlier', async () => {
    prisma.parentClassroomInvitation.findMany.mockResolvedValue([]);
    await expect(service.addChildren(parent, selections)).rejects.toThrow(
      'รหัสห้อง',
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
  it('rejects duplicate selections and concurrent claims so the transaction can roll back', async () => {
    await expect(
      service.addChildren(parent, [selections[0], selections[0]]),
    ).rejects.toThrow('ไม่ซ้ำ');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.addChildren(parent, selections)).rejects.toThrow(
      'เปลี่ยนแปลง',
    );
  });
  it("removes only the requesting parent's link and permits removing the last child", async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await service.removeChild(parent, 's1');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', role: Role.STUDENT, parentId: 'parent' },
      data: { parentId: null },
    });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.removeChild(parent, 'someone-elses-child'),
    ).rejects.toThrow('บัญชีนี้');
  });
  it('lets a teacher remove only a child linked to that teacher account', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    await service.removeChild({ userId: 'teacher', role: Role.TEACHER }, 's1');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', role: Role.STUDENT, parentId: 'teacher' },
      data: { parentId: null },
    });
  });
});
