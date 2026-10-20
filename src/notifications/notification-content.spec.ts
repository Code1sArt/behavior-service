import { AttendanceStatus, AttendanceType, PointType } from '@prisma/client';
import { attendanceContent, behaviorContent } from './notification-content';

describe('event notification content', () => {
  it('distinguishes awards, deductions and cancellations with category and amount', () => {
    expect(
      behaviorContent({ name: 'ช่วยงานโรงเรียน', type: PointType.ADD }, 5),
    ).toEqual({
      title: 'เพิ่มคะแนน',
      body: 'เพิ่มคะแนน 5 คะแนน · ช่วยงานโรงเรียน',
    });
    expect(
      behaviorContent({ name: 'แต่งกายผิดระเบียบ', type: PointType.DEDUCT }, 3),
    ).toEqual({
      title: 'หักคะแนน',
      body: 'หักคะแนน 3 คะแนน · แต่งกายผิดระเบียบ',
    });
    expect(
      behaviorContent(
        { name: 'แต่งกายผิดระเบียบ', type: PointType.DEDUCT },
        3,
        true,
      ).title,
    ).toBe('ยกเลิกรายการหักคะแนน');
  });
  it.each([
    [AttendanceStatus.PRESENT, 'มาเรียน'],
    [AttendanceStatus.LATE, 'มาสาย'],
    [AttendanceStatus.ABSENT, 'ขาดเรียน'],
    [AttendanceStatus.LEAVE, 'ลา'],
    [AttendanceStatus.ACTIVITY, 'เข้าร่วมกิจกรรม'],
  ])(
    'explains %s with attendance type and Bangkok event date',
    (status, label) => {
      const content = attendanceContent(
        status,
        AttendanceType.AREA,
        new Date('2026-10-19T18:00:00Z'),
      );
      expect(content.title).toBe(label);
      expect(content.body).toContain(`เช็คชื่อเขตพื้นที่ · ${label}`);
      expect(content.body).toContain('20');
      expect(content.body).toContain('2569');
    },
  );
  it('marks corrections and preserves the date being corrected', () => {
    const content = attendanceContent(
      AttendanceStatus.PRESENT,
      AttendanceType.ASSEMBLY,
      new Date('2026-10-10T01:00:00Z'),
      true,
    );
    expect(content.title).toBe('แก้ไขสถานะ: มาเรียน');
    expect(content.body).toContain('เช็คชื่อเข้าแถว');
    expect(content.body).toContain('10');
  });
});
