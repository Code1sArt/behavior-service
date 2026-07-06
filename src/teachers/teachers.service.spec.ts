import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeachersService } from './teachers.service';

describe('TeachersService', () => {
  it('includes administrators in the staff list', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TeachersService({
      user: { findMany },
    } as unknown as PrismaService);

    await service.findAllStaff();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: {
            in: [Role.TEACHER, Role.AFFAIRS, Role.ADMIN],
          },
        },
      }),
    );
  });
});
