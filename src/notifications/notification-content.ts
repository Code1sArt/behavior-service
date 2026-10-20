import { AttendanceStatus, AttendanceType, PointType } from '@prisma/client';

export interface NotificationContent {
  title: string;
  body: string;
}

export function behaviorContent(
  category: { name: string; type: PointType },
  points: number,
  cancelled = false,
): NotificationContent {
  const action = category.type === PointType.DEDUCT ? 'หักคะแนน' : 'เพิ่มคะแนน';
  return {
    title: cancelled ? `ยกเลิกรายการ${action}` : action,
    body: `${cancelled ? 'ยกเลิกรายการ' : ''}${action} ${Math.abs(points)} คะแนน · ${category.name}`,
  };
}

export function attendanceContent(
  status: AttendanceStatus,
  type: AttendanceType,
  date: Date,
  updated = false,
): NotificationContent {
  const labels: Record<AttendanceStatus, string> = {
    PRESENT: 'มาเรียน',
    LATE: 'มาสาย',
    ABSENT: 'ขาดเรียน',
    LEAVE: 'ลา',
    ACTIVITY: 'เข้าร่วมกิจกรรม',
  };
  const area =
    type === AttendanceType.AREA ? 'เช็คชื่อเขตพื้นที่' : 'เช็คชื่อเข้าแถว';
  const day = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  return {
    title: `${updated ? 'แก้ไขสถานะ: ' : ''}${labels[status]}`,
    body: `${area} · ${labels[status]} · ${day}`,
  };
}
