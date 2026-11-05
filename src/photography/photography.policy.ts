import { BadRequestException } from '@nestjs/common';

export interface TimeSlot {
  startsAt: Date;
  endsAt: Date;
}

export function bookingSlots(
  input: { startsAt: string; endsAt: string }[],
  now = new Date(),
): TimeSlot[] {
  const slots = input
    .map((s) => ({
      startsAt: new Date(s.startsAt),
      endsAt: new Date(s.endsAt),
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (!slots.length || slots.length > 31)
    throw new BadRequestException('ระบุช่วงเวลา 1–31 ช่วง');
  for (let i = 0; i < slots.length; i++) {
    const { startsAt, endsAt } = slots[i];
    // Require an explicit timezone so every client books the same instant.
    const zoned = input.every((s) =>
      [s.startsAt, s.endsAt].every((v) => /(Z|[+-]\d{2}:\d{2})$/.test(v)),
    );
    if (
      !zoned ||
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt <= now ||
      endsAt <= startsAt
    ) {
      throw new BadRequestException(
        'วันเวลาต้องอยู่ในอนาคต เวลาเริ่มต้องก่อนเวลาสิ้นสุด และต้องระบุเขตเวลา',
      );
    }
    if (i > 0 && startsAt < slots[i - 1].endsAt)
      throw new BadRequestException('ช่วงเวลาของงานเดียวกันต้องไม่ซ้อนกัน');
  }
  return slots;
}

// Half-open intervals: a reservation ending at 12:00 does not block one starting at 12:00.
export function peakQuantity(
  reservations: (TimeSlot & { quantity: number })[],
): number {
  const events = reservations
    .flatMap((s) => [
      { at: s.startsAt.getTime(), delta: s.quantity },
      { at: s.endsAt.getTime(), delta: -s.quantity },
    ])
    .sort((a, b) => a.at - b.at || a.delta - b.delta);
  let count = 0,
    peak = 0;
  for (const event of events) {
    count += event.delta;
    peak = Math.max(peak, count);
  }
  return peak;
}
