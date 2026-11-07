import { Role } from '@prisma/client';
import { ParentsService } from './parents.service';

const dto = {
  citizenId: '1234567890123',
  firstName: 'Test',
  lastName: 'Parent',
  password: 'safe-test-password',
  studentCitizenId: 's1',
  invitationCode: 'school-issued-code',
};
const actor = { userId: 'parent', role: Role.PARENT };
describe('verified parent linking', () => {
  const tx = {
    user: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    parentLinkInvitation: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn) => fn(tx)),
    user: { findUnique: jest.fn() },
    parentLinkInvitation: { create: jest.fn() },
  };
  const line = { verify: jest.fn() };
  const classroomLinks = { validate: jest.fn(), attach: jest.fn() };
  const service = new ParentsService(
    prisma as any,
    {} as any,
    line as any,
    classroomLinks as any,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
      parentId: null,
    });
    tx.user.create.mockResolvedValue({
      id: 'new-parent',
      password: 'HASH',
      role: Role.PARENT,
    });
    tx.user.updateMany.mockResolvedValue({ count: 1 });
    tx.parentLinkInvitation.updateMany.mockResolvedValue({ count: 1 });
  });
  it('registers one parent with multiple selected students in one transaction', async () => {
    const students = [
      { studentId: 'second', invitationCode: 'aB3xY' },
      { studentId: 'third', invitationCode: 'xY7zQ' },
    ];
    const validated = [
      { id: 'second', classroomId: 1 },
      { id: 'third', classroomId: 2 },
    ];
    classroomLinks.validate.mockResolvedValue(validated);
    await service.register({
      ...dto,
      studentCitizenId: undefined,
      invitationCode: undefined,
      students,
    });
    expect(classroomLinks.validate).toHaveBeenCalledWith(tx, students);
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(classroomLinks.attach).toHaveBeenCalledWith(
      tx,
      'new-parent',
      validated,
    );
    expect(tx.parentLinkInvitation.updateMany).not.toHaveBeenCalled();
  });
  it('validates all room selections before creating an account', async () => {
    classroomLinks.validate.mockRejectedValue(new Error('invalid room code'));
    await expect(
      service.register({
        ...dto,
        students: [{ studentId: 'other', invitationCode: 'aB3xY' }],
      }),
    ).rejects.toThrow('invalid room code');
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it('requires school proof before querying or creating a public account', async () => {
    await expect(
      service.register({ ...dto, invitationCode: undefined }),
    ).rejects.toThrow('รหัสเชื่อมโยง');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects expired, mismatched or reused proof without creating an account', async () => {
    tx.parentLinkInvitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.register(dto)).rejects.toThrow('หมดอายุ');
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
  it('claims student-specific codes atomically and retains legacy parent binding', async () => {
    const result = await service.register(dto);
    expect(tx.parentLinkInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId: 'student',
          OR: [{ parentCitizenId: null }, { parentCitizenId: dto.citizenId }],
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
        data: { usedAt: expect.any(Date), parentCitizenId: dto.citizenId },
      }),
    );
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'student', role: Role.STUDENT, parentId: null },
      data: { parentId: 'new-parent' },
    });
    expect(result.user).not.toHaveProperty('password');
    expect(tx.user.create.mock.calls[0][0].data.lineUserId).toBeNull();
  });
  it('never replaces a pre-existing parent', async () => {
    tx.user.findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
      parentId: 'existing-parent',
    });
    await expect(service.register(dto)).rejects.toThrow();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
  it('throws on a concurrent link so the transaction rolls back account + invitation', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.register(dto)).rejects.toThrow('มีผู้ปกครองแล้ว');
  });
  it('forbids a parent selecting another parentId', async () => {
    await expect(
      service.addChild('other-parent', { studentCitizenId: 's1' }, actor),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('adds a second and third child from different rooms to the same existing account', async () => {
    const parent = {
      id: actor.userId,
      role: Role.PARENT,
      citizenId: dto.citizenId,
      children: [{ id: 'first-child' }],
    };
    const children = [
      { id: 'second-child', citizenId: 's2', classroom: { name: 'ม.1/1' } },
      { id: 'third-child', citizenId: 's3', classroom: { name: 'ม.4/2' } },
    ];

    for (const child of children) {
      tx.user.findUnique
        .mockResolvedValueOnce(parent)
        .mockResolvedValueOnce({ ...child, role: Role.STUDENT, parentId: null })
        .mockResolvedValueOnce(child);
      await expect(
        service.addChild(
          parent.id,
          {
            studentCitizenId: child.citizenId,
            invitationCode: `code-for-${child.id}`,
          },
          actor,
        ),
      ).resolves.toEqual(child);
    }

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).toHaveBeenCalledTimes(2);
    for (const [index, child] of children.entries()) {
      expect(tx.user.updateMany).toHaveBeenNthCalledWith(index + 1, {
        where: { id: child.id, role: Role.STUDENT, parentId: null },
        data: { parentId: parent.id },
      });
      expect(tx.parentLinkInvitation.updateMany).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({
          where: expect.objectContaining({ studentId: child.id, usedAt: null }),
          data: { usedAt: expect.any(Date), parentCitizenId: parent.citizenId },
        }),
      );
    }
    const claims = tx.parentLinkInvitation.updateMany.mock.calls;
    expect(claims[0][0].where.tokenHash).not.toBe(claims[1][0].where.tokenHash);
  });
  it("requires the next child's code even when the parent already has children", async () => {
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: actor.userId,
        role: Role.PARENT,
        citizenId: dto.citizenId,
      })
      .mockResolvedValueOnce({
        id: 'second-child',
        role: Role.STUDENT,
        parentId: null,
      });
    await expect(
      service.addChild(actor.userId, { studentCitizenId: 's2' }, actor),
    ).rejects.toThrow('รหัสเชื่อมโยง');
    expect(tx.parentLinkInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a code for another child, an expired code or a reused code without changing any links', async () => {
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: actor.userId,
        role: Role.PARENT,
        citizenId: dto.citizenId,
      })
      .mockResolvedValueOnce({
        id: 'second-child',
        role: Role.STUDENT,
        parentId: null,
      });
    tx.parentLinkInvitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.addChild(
        actor.userId,
        { studentCitizenId: 's2', invitationCode: 'code-for-first-child' },
        actor,
      ),
    ).rejects.toThrow('หมดอายุ');
    expect(tx.parentLinkInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId: 'second-child',
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
  });
  it('rejects adding a child who is already linked without claiming another code', async () => {
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: actor.userId,
        role: Role.PARENT,
        citizenId: dto.citizenId,
      })
      .mockResolvedValueOnce({
        id: 'second-child',
        role: Role.STUDENT,
        parentId: 'another-parent',
      });
    await expect(
      service.addChild(
        actor.userId,
        { studentCitizenId: 's2', invitationCode: 'second-code' },
        actor,
      ),
    ).rejects.toThrow('ไม่สามารถเชื่อมโยง');
    expect(tx.parentLinkInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
  it('lets an admin add the next child to an existing account without creating a duplicate account', async () => {
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: actor.userId,
        role: Role.PARENT,
        citizenId: dto.citizenId,
      })
      .mockResolvedValueOnce({
        id: 'second-child',
        role: Role.STUDENT,
        parentId: null,
      })
      .mockResolvedValueOnce({ firstName: 'Second', lastName: 'Child' });
    await service.addChild(
      actor.userId,
      { studentCitizenId: 's2' },
      { userId: 'admin', role: Role.ADMIN },
    );
    expect(tx.parentLinkInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'second-child', role: Role.STUDENT, parentId: null },
      data: { parentId: actor.userId },
    });
  });
  it('uses verified LINE identity rather than trusting a supplied ID', async () => {
    line.verify.mockRejectedValue(new Error('invalid LINE token'));
    await expect(
      service.register({
        ...dto,
        lineUserId: 'forged',
        accessToken: 'invalid',
      }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('issues only a hash in storage with a 14-day expiry and parent binding', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
      parentId: null,
    });
    const result = await service.issueInvitation(
      { studentCitizenId: 's1', parentCitizenId: dto.citizenId },
      { userId: 'admin', role: Role.ADMIN },
    );
    const data = prisma.parentLinkInvitation.create.mock.calls[0][0].data;
    expect(result.invitationCode.length).toBeGreaterThanOrEqual(40);
    expect(data.tokenHash).not.toBe(result.invitationCode);
    expect(data.tokenHash).toHaveLength(64);
    expect(data.parentCitizenId).toBe(dto.citizenId);
    expect(data).not.toHaveProperty('invitationCode');
  });
  it('issues student-specific codes without asking staff for a parent ID', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
      parentId: null,
    });
    const before = Date.now();
    const result = await service.issueInvitation(
      { studentCitizenId: 's1' },
      { userId: 'staff', role: Role.AFFAIRS },
    );
    const data = prisma.parentLinkInvitation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      studentId: 'student',
      parentCitizenId: null,
      issuedBy: 'staff',
    });
    expect(data.tokenHash).toHaveLength(64);
    expect(data.tokenHash).not.toBe(result.invitationCode);
    const expiresAt = result.expiresAt.getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 14 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 14 * 24 * 60 * 60 * 1000);
  });
  it('still refuses to issue a code for a student with an existing parent', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
      parentId: 'existing-parent',
    });
    await expect(
      service.issueInvitation(
        { studentCitizenId: 's1' },
        { userId: 'admin', role: Role.ADMIN },
      ),
    ).rejects.toThrow('มีผู้ปกครองแล้ว');
    expect(prisma.parentLinkInvitation.create).not.toHaveBeenCalled();
  });
  it('does not let a family account issue its own school proof', async () => {
    await expect(
      service.issueInvitation(
        { studentCitizenId: 's1', parentCitizenId: dto.citizenId },
        actor,
      ),
    ).rejects.toThrow();
    expect(prisma.parentLinkInvitation.create).not.toHaveBeenCalled();
  });
});
