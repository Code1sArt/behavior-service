import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it.each([
    { parentId: 'forged-parent' },
    { classroomId: 2 },
    { citizenId: 'forged-id' },
    { lineUserId: 'forged-line' },
  ])(
    'prevents own profile from bypassing verified relationship fields: %o',
    async (dto) => {
      await expect(
        service.updateUser(
          'user-1',
          { userId: 'user-1', role: Role.STUDENT },
          dto,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it.each([Role.STUDENT, Role.PARENT, Role.TEACHER, Role.AFFAIRS])(
    'prevents %s changing their own name',
    async (role) => {
      for (const dto of [{ firstName: 'Changed' }, { lastName: 'Changed' }]) {
        await expect(
          service.updateUser('self', { userId: 'self', role }, dto),
        ).rejects.toThrow(ForbiddenException);
      }
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it('allows an admin to correct a name for school administration', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'student',
      role: Role.STUDENT,
    });
    prisma.user.update.mockResolvedValue({
      id: 'student',
      firstName: 'Corrected',
      password: 'hidden',
    });
    const result = await service.updateUser(
      'student',
      { userId: 'admin', role: Role.ADMIN },
      { firstName: 'Corrected' },
    );
    expect(result.user.firstName).toBe('Corrected');
    expect(result.user).not.toHaveProperty('password');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('prevents a non-admin user from updating another user', async () => {
    await expect(
      service.updateUser(
        'user-2',
        { userId: 'user-1', role: Role.TEACHER },
        { firstName: 'Updated' },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('prevents a non-admin user from changing their own role', async () => {
    await expect(
      service.updateUser(
        'user-1',
        { userId: 'user-1', role: Role.TEACHER },
        { role: Role.ADMIN },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('prevents an admin from changing their own role', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: Role.ADMIN,
      classroomId: null,
    });

    await expect(
      service.updateUser(
        'admin-1',
        { userId: 'admin-1', role: Role.ADMIN },
        { role: Role.TEACHER },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
