import { ClassroomsService } from './classrooms.service';

describe('ClassroomsService historical identity guard', () => {
  it('rejects renaming a classroom that already has history', async () => {
    const prisma = {
      classroom: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          name: 'ม.1/1',
          termId: 1,
          _count: {
            students: 0,
            enrollments: 1,
            attendanceRecords: 5,
            behaviorRecords: 2,
          },
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new ClassroomsService(prisma as never);

    await expect(service.update(10, { name: 'ม.2/1' })).rejects.toThrow(
      'ไม่สามารถเปลี่ยนชื่อหรือภาคเรียนของห้องที่มีประวัติแล้ว',
    );
    expect(prisma.classroom.update).not.toHaveBeenCalled();
  });

  it('still allows changing advisors without changing historical identity', async () => {
    let updateArguments: unknown;
    const update = jest.fn((argumentsValue: unknown) => {
      updateArguments = argumentsValue;
      return Promise.resolve({ id: 10 });
    });
    const prisma = {
      classroom: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          name: 'ม.1/1',
          termId: 1,
          _count: {
            students: 1,
            enrollments: 1,
            attendanceRecords: 5,
            behaviorRecords: 2,
          },
        }),
        findFirst: jest.fn(),
        update,
      },
    };
    const service = new ClassroomsService(prisma as never);

    await service.update(10, { advisorIds: ['teacher-1'] });

    const call = updateArguments as {
      data: { advisors: { set: Array<{ id: string }> } };
    };
    expect(call.data.advisors).toEqual({
      set: [{ id: 'teacher-1' }],
    });
  });
});
