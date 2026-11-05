import { bookingSlots, peakQuantity } from './photography.policy';
const now = new Date('2030-01-01T00:00:00Z');
const slot = (start: string, end: string) => ({
  startsAt: `2030-01-${start}`,
  endsAt: `2030-01-${end}`,
});
describe('Photography time and capacity rules', () => {
  it('normalizes Bangkok times and accepts distinct days', () => {
    const result = bookingSlots(
      [
        {
          startsAt: '2030-01-03T09:00:00+07:00',
          endsAt: '2030-01-03T12:00:00+07:00',
        },
        {
          startsAt: '2030-01-02T09:00:00+07:00',
          endsAt: '2030-01-02T12:00:00+07:00',
        },
      ],
      now,
    );
    expect(result[0].startsAt.toISOString()).toBe('2030-01-02T02:00:00.000Z');
    expect(result).toHaveLength(2);
  });
  it.each(
    [
      [],
      [slot('02T09:00:00Z', '02T08:00:00Z')],
      [slot('02T09:00:00Z', '02T09:00:00Z')],
      [slot('01T00:00:00Z', '02T09:00:00Z')],
      [slot('02T09:00:00', '02T10:00:00')],
      [
        slot('02T09:00:00Z', '02T12:00:00Z'),
        slot('02T11:00:00Z', '02T13:00:00Z'),
      ],
      Array.from({ length: 32 }, () => slot('02T09:00:00Z', '02T10:00:00Z')),
    ].map((slots) => [slots]),
  )(
    'rejects invalid, past, timezone-free, overlapping or excessive ranges %#',
    (input) => {
      expect(() => bookingSlots(input, now)).toThrow();
    },
  );
  it('allows adjacent ranges and a range spanning several days', () => {
    expect(
      bookingSlots(
        [
          slot('02T09:00:00Z', '04T09:00:00Z'),
          slot('04T09:00:00Z', '04T10:00:00Z'),
        ],
        now,
      ),
    ).toHaveLength(2);
  });
  it('uses peak simultaneous demand instead of summing all bookings', () => {
    const range = (start: number, end: number, quantity: number) => ({
      startsAt: new Date(start),
      endsAt: new Date(end),
      quantity,
    });
    expect(
      peakQuantity([range(0, 10, 2), range(10, 20, 2), range(5, 15, 1)]),
    ).toBe(3);
    expect(peakQuantity([range(0, 10, 2), range(10, 20, 2)])).toBe(2);
  });
});
