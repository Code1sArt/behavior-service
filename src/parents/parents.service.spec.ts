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
  const service = new ParentsService(prisma as any, {} as any, line as any);
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
  it('binds proof to student + parent ID and consumes it in the same transaction', async () => {
    const result = await service.register(dto);
    expect(tx.parentLinkInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId: 'student',
          parentCitizenId: dto.citizenId,
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        }),
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
  it('issues only a hash in storage with a 24h expiry and parent binding', async () => {
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
