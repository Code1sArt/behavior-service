import { PointType } from '@prisma/client';

export interface LegacyPointRecord {
  points: number;
  category: {
    type: PointType;
  } | null;
}

export const calculateLegacyPointDelta = (record: LegacyPointRecord) =>
  record.category?.type === PointType.ADD ? record.points : -record.points;

export const calculateLegacyScore = (
  initialPoints: number,
  records: LegacyPointRecord[],
) =>
  records.reduce(
    (score, record) => score + calculateLegacyPointDelta(record),
    initialPoints,
  );

export const calculateLedgerScore = (
  initialPoints: number,
  pointDeltas: number[],
) => pointDeltas.reduce((score, delta) => score + delta, initialPoints);
