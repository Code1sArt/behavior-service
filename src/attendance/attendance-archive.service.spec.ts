import { gunzipSync } from 'node:zlib';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceArchiveService } from './attendance-archive.service';
import { lockAttendanceTerm } from './attendance-archive-state';

const record = () => ({
  id: 'record-1',
  type: 'ASSEMBLY',
  status: 'ABSENT',
  date: new Date('2026-01-05T01:00:00Z'),
  studentId: 'student-1',
  recorderId: 'teacher-1',
  termId: 1,
  classroomId: 10,
  student: {
    id: 'student-1',
    citizenId: '00123',
    firstName: "ทดสอบ ' ; DROP TABLE User; -- 😄",
    lastName: 'นามสกุล\\ทดสอบ\nใหม่',
  },
  recorder: { id: 'teacher-1', firstName: 'ครู', lastName: 'ทดสอบ' },
  classroom: { id: 10, name: 'ม.1/1' },
  term: { id: 1, term: 1, year: 2569 },
});
const decode = (sql: string) => {
  const encoded = sql
    .split('-- DSPS_ARCHIVE_BEGIN\n')[1]
    .split('\n-- DSPS_ARCHIVE_END')[0]
    .split('\n')
    .map((line) => line.slice(3))
    .join('');
  return JSON.parse(Buffer.from(encoded, 'base64').toString()) as {
    receipt: string;
    count: number;
    digest: string;
    records: ReturnType<typeof record>[];
  };
};

describe('attendance archive safety', () => {
  let service: AttendanceArchiveService;
  let rows: ReturnType<typeof record>[];
  const findMany = jest.fn();
  const findTerms = jest.fn();
  const deleteMany = jest.fn();
  const upsert = jest.fn();
  const update = jest.fn();
  const tx = {
    attendanceRecord: { findMany, deleteMany },
    academicTerm: { findMany: findTerms },
    systemConfig: { upsert, update },
  };
  const transaction = jest.fn(
    async (callback: (client: unknown) => Promise<unknown>) => callback(tx),
  );
  const prisma = {
    ...tx,
    $transaction: transaction,
  } as unknown as PrismaService;
  let originalSecret: string | undefined;
  beforeAll(() => {
    originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'archive-test-secret';
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    rows = [record()];
    findMany.mockImplementation(
      (args: {
        take?: number;
        cursor?: { id: string };
        where?: { termId?: { in: number[] } };
      }) => {
        const selected = rows.filter(
          (row) =>
            !args.where?.termId || args.where.termId.in.includes(row.termId),
        );
        const offset = args.cursor
          ? selected.findIndex((row) => row.id === args.cursor!.id) + 1
          : 0;
        return Promise.resolve(
          args.take ? selected.slice(offset, offset + args.take) : selected,
        );
      },
    );
    findTerms.mockResolvedValue([
      { id: 1, isActive: false, endDate: new Date('2020-01-01') },
    ]);
    deleteMany.mockResolvedValue({ count: 1 });
    upsert.mockResolvedValue({ value: 'OPEN' });
    update.mockResolvedValue({});
    service = new AttendanceArchiveService(prisma);
  });

  it('exports every attendance type/status with Unicode snapshots into a standalone SQL table', async () => {
    rows.push({
      ...record(),
      id: 'record-2',
      type: 'AREA',
      status: 'ACTIVITY',
    });
    const sql = await service.exportSql();
    const archive = decode(sql);
    expect(archive.count).toBe(2);
    expect(archive.digest).toBe(
      createHash('sha256')
        .update(JSON.stringify(archive.records))
        .digest('hex'),
    );
    expect(archive.records[0].student.firstName).toBe(
      rows[0].student.firstName,
    );
    const statements = sql.split('-- DSPS_ARCHIVE_END\n')[1];
    expect(statements).toContain(
      'CREATE TABLE IF NOT EXISTS `DSPSAttendanceArchive_v1`',
    );
    expect(statements.match(/INSERT INTO/g)).toHaveLength(2);
    expect(statements).not.toContain('DROP TABLE');
    expect(statements).not.toMatch(
      /(?:INSERT INTO|DELETE FROM|UPDATE) `(?:AttendanceRecord|BehaviorRecord|User|StudentPointAccount)`/,
    );
    const hex = statements.match(
      /CONVERT\(X'[a-f0-9]+' USING utf8mb4\), CONVERT\(X'([a-f0-9]+)'/,
    )![1];
    expect(JSON.parse(Buffer.from(hex, 'hex').toString())).toEqual(
      archive.records[0],
    );
  });
  it('can scope export to exactly one term and rejects invalid/empty selections', async () => {
    await service.exportSql(1);
    expect((findMany.mock.calls as [{ where: unknown }][])[0][0].where).toEqual(
      {
        termId: { in: [1] },
      },
    );
    await expect(service.exportSql(NaN)).rejects.toThrow(BadRequestException);
    rows = [];
    await expect(service.exportSql()).rejects.toThrow('ไม่มีประวัติ');
  });
  it('purges only matching attendance, preserves the score ledger and writes a permanent guard', async () => {
    // Any access to ledger delegates would fail: they intentionally do not exist on tx.
    const { receipt } = decode(await service.exportSql(1));
    await expect(service.purge(receipt, 'admin-1')).resolves.toEqual({
      deletedCount: 1,
      termIds: [1],
      scoresPreserved: true,
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { termId: { in: [1] } } });
    expect(update).toHaveBeenCalledWith({
      where: { key: 'ATTENDANCE_TERM_STATE_1' },
      data: { value: expect.stringContaining('admin-1') as string },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 120000,
    });
  });
  it.each(['status', 'added', 'removed', 'renamed'])(
    'rejects a stale backup after records are %s',
    async (change) => {
      const { receipt } = decode(await service.exportSql());
      if (change === 'status') rows[0].status = 'PRESENT';
      if (change === 'added') rows.push({ ...record(), id: 'record-2' });
      if (change === 'removed') rows = [];
      if (change === 'renamed') rows[0].classroom.name = 'ม.2/1';
      await expect(service.purge(receipt, 'admin')).rejects.toThrow(
        ConflictException,
      );
      expect(deleteMany).not.toHaveBeenCalled();
    },
  );
  const collectGzip = async (stream: Readable) => {
    const buffers: Buffer[] = [];
    for await (const chunk of stream) buffers.push(chunk as Buffer);
    return gunzipSync(Buffer.concat(buffers)).toString();
  };
  const decodeV2 = (sql: string) =>
    JSON.parse(
      Buffer.from(
        sql.trim().split('-- DSPS_ARCHIVE_V2_END ')[1],
        'base64',
      ).toString(),
    ) as { receipt: string; count: number; chunks: number };

  it('streams compressed SQL in bounded pages and checks the same pages before purge', async () => {
    rows = Array.from({ length: 2001 }, (_, index) => ({
      ...record(),
      id: `record-${String(index).padStart(5, '0')}`,
    }));
    const sql = await collectGzip(await service.exportGzip(1));
    const manifest = decodeV2(sql);
    expect(manifest.count).toBe(2001);
    expect(manifest.chunks).toBe(3);
    expect(sql).not.toContain('-- DSPS_ARCHIVE_BEGIN'); // No duplicate base64 dataset.
    expect(sql.match(/INSERT INTO/g)).toHaveLength(2001);
    const calls = findMany.mock.calls as [
      { take: number; cursor?: { id: string }; skip?: number },
    ][];
    expect(calls.map((call) => call[0].take)).toEqual([1000, 1000, 1000]);
    expect(calls[1][0]).toMatchObject({
      cursor: { id: 'record-00999' },
      skip: 1,
    });
    deleteMany.mockResolvedValue({ count: 2001 });
    await expect(
      service.purge(manifest.receipt, 'admin'),
    ).resolves.toMatchObject({ deletedCount: 2001, scoresPreserved: true });
  });
  it('rejects a stale v2 archive without deleting any attendance or scores', async () => {
    const archive = decodeV2(await collectGzip(await service.exportGzip()));
    rows[0].status = 'PRESENT';
    await expect(service.purge(archive.receipt, 'admin')).rejects.toThrow(
      ConflictException,
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('does not generate a completed archive if a later database page fails', async () => {
    rows = Array.from({ length: 1000 }, (_, index) => ({
      ...record(),
      id: `record-${index}`,
    }));
    const stream = await service.exportGzip();
    findMany.mockRejectedValueOnce(new Error('database read interrupted'));
    await expect(collectGzip(stream)).rejects.toThrow(
      'database read interrupted',
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('validates empty and invalid gzip exports before opening the HTTP stream', async () => {
    await expect(service.exportGzip(0)).rejects.toThrow(BadRequestException);
    rows = [];
    await expect(service.exportGzip()).rejects.toThrow('ไม่มีประวัติ');
  });
  it('rejects a forged receipt before starting a transaction', async () => {
    const { receipt } = decode(await service.exportSql());
    const [payload] = receipt.split('.');
    await expect(
      service.purge(
        `${payload}.${Buffer.alloc(32).toString('base64url')}`,
        'admin',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([
    { id: 1, isActive: true, endDate: new Date('2020-01-01') },
    { id: 1, isActive: false, endDate: new Date('2999-01-01') },
  ])('rejects active or unfinished terms: %j', async (term) => {
    const { receipt } = decode(await service.exportSql());
    findTerms.mockResolvedValue([term]);
    await expect(service.purge(receipt, 'admin')).rejects.toThrow(
      'ล้างได้เฉพาะ',
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
  it('checks the Bangkok day boundary including the full last day of term', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-25T18:00:00Z')); // Oct 26, 01:00 Bangkok
    try {
      const { receipt } = decode(await service.exportSql());
      findTerms.mockResolvedValue([
        { id: 1, isActive: false, endDate: new Date('2026-10-26') },
      ]);
      await expect(service.purge(receipt, 'admin')).rejects.toThrow(
        'ล้างได้เฉพาะ',
      );
      findTerms.mockResolvedValue([
        { id: 1, isActive: false, endDate: new Date('2026-10-25') },
      ]);
      await expect(service.purge(receipt, 'admin')).resolves.toMatchObject({
        deletedCount: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('rejects repeated purge and future attendance writes for an archived term', async () => {
    const { receipt } = decode(await service.exportSql());
    upsert.mockResolvedValue({ value: '{"archivedAt":"2026-01-01"}' });
    await expect(service.purge(receipt, 'admin')).rejects.toThrow('เก็บถาวร');
    await expect(lockAttendanceTerm(tx as never, 1)).rejects.toThrow(
      'เก็บถาวร',
    );
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
