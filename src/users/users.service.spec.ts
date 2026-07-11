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
