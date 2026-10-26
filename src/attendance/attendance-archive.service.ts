import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Readable, pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  attendanceTermStateKey,
  lockAttendanceTerm,
} from './attendance-archive-state';

const archiveInclude = {
  student: {
    select: { id: true, citizenId: true, firstName: true, lastName: true },
  },
  recorder: { select: { id: true, firstName: true, lastName: true } },
  classroom: { select: { id: true, name: true } },
  term: { select: { id: true, term: true, year: true } },
} satisfies Prisma.AttendanceRecordInclude;

type Snapshot = Awaited<ReturnType<AttendanceArchiveService['snapshot']>>;
const ARCHIVE_BATCH_SIZE = 1000;
type BatchDigest = { count: number; digest: string };
type Receipt = {
  version: 1 | 2;
  termIds: number[];
  digest: string;
  count: number;
};

@Injectable()
export class AttendanceArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  private secret() {
    const secret = process.env.JWT_SECRET;
    if (!secret)
      throw new ServiceUnavailableException('ยังไม่ได้ตั้งค่า JWT_SECRET');
    return secret;
  }

  private sign(value: string) {
    return createHmac('sha256', this.secret()).update(value).digest();
  }

  private receipt(data: Receipt) {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${payload}.${this.sign(payload).toString('base64url')}`;
  }

  private verify(token: string): Receipt {
    try {
      const [payload, signature, extra] = token.split('.');
      if (!payload || !signature || extra) throw new Error();
      const expected = this.sign(payload);
      const actual = Buffer.from(signature, 'base64url');
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const data = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as Receipt;
      if (
        (data.version !== 1 && data.version !== 2) ||
        !Array.isArray(data.termIds) ||
        !data.termIds.length ||
        !data.termIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
        !Number.isSafeInteger(data.count) ||
        data.count <= 0 ||
        !/^[a-f0-9]{64}$/.test(data.digest)
      )
        throw new Error();
      return data;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException(
        'หลักฐานไฟล์สำรองไม่ถูกต้อง กรุณาส่งออกไฟล์ใหม่',
      );
    }
  }

  async snapshot(tx: Prisma.TransactionClient, termIds?: number[]) {
    // Stable ordering makes the receipt detect any changed/added/deleted record
    // and any changed student, recorder, classroom or term snapshot.
    return tx.attendanceRecord.findMany({
      where: termIds ? { termId: { in: termIds } } : {},
      include: archiveInclude,
      orderBy: { id: 'asc' },
    });
  }

  private digest(records: Snapshot) {
    return createHash('sha256').update(JSON.stringify(records)).digest('hex');
  }

  async exportSql(termId?: number) {
    if (
      termId !== undefined &&
      (!Number.isSafeInteger(termId) || termId <= 0)
    ) {
      throw new BadRequestException('ภาคเรียนไม่ถูกต้อง');
    }
    const records = await this.snapshot(
      this.prisma,
      termId ? [termId] : undefined,
    );
    if (!records.length)
      throw new BadRequestException('ไม่มีประวัติเช็คชื่อให้ส่งออก');
    const digest = this.digest(records);
    const termIds = [...new Set(records.map((record) => record.termId))].sort(
      (a, b) => a - b,
    );
    const payload = {
      format: 'dsps-attendance-archive',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: records.length,
      digest,
      receipt: this.receipt({
        version: 1,
        termIds,
        digest,
        count: records.length,
      }),
      records,
    };
    const base64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const lines = [
      '-- DSPS CARE attendance archive v1 (MySQL / MariaDB, UTF-8)',
      '-- Historical snapshots only. Does not modify live attendance or scores.',
      '-- Open this file in the admin archive reader to view without importing.',
      '-- DSPS_ARCHIVE_BEGIN',
      ...base64.match(/.{1,120}/g)!.map((line) => `-- ${line}`),
      '-- DSPS_ARCHIVE_END',
      'SET NAMES utf8mb4;',
      'CREATE TABLE IF NOT EXISTS `DSPSAttendanceArchive_v1` (`id` VARCHAR(191) NOT NULL PRIMARY KEY, `recordJson` LONGTEXT NOT NULL) CHARACTER SET utf8mb4;',
      'START TRANSACTION;',
      ...records.map((record) => {
        // Hex literals work regardless of SQL modes and safely preserve all text.
        const id = Buffer.from(record.id).toString('hex');
        const json = Buffer.from(JSON.stringify(record)).toString('hex');
        return `INSERT INTO \`DSPSAttendanceArchive_v1\` (\`id\`, \`recordJson\`) VALUES (CONVERT(X'${id}' USING utf8mb4), CONVERT(X'${json}' USING utf8mb4));`;
      }),
      'COMMIT;',
      '',
    ];
    return lines.join('\n');
  }

  // Only one database page and one SQL batch are retained while compressing.
  private async *pages(tx: Prisma.TransactionClient, termIds?: number[]) {
    let cursor: string | undefined;
    while (true) {
      const records = await tx.attendanceRecord.findMany({
        where: termIds ? { termId: { in: termIds } } : {},
        include: archiveInclude,
        orderBy: { id: 'asc' },
        take: ARCHIVE_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!records.length) return;
      yield records;
      if (records.length < ARCHIVE_BATCH_SIZE) return;
      cursor = records[records.length - 1].id;
    }
  }

  private chunksDigest(chunks: BatchDigest[]) {
    return createHash('sha256').update(JSON.stringify(chunks)).digest('hex');
  }

  async exportGzip(termId?: number) {
    if (
      termId !== undefined &&
      (!Number.isSafeInteger(termId) || termId <= 0)
    ) {
      throw new BadRequestException('ภาคเรียนไม่ถูกต้อง');
    }
    this.secret(); // Fail before sending response headers if signing is unavailable.
    const pages = this.pages(this.prisma, termId ? [termId] : undefined);
    const first = await pages.next();
    if (first.done)
      throw new BadRequestException('ไม่มีประวัติเช็คชื่อให้ส่งออก');
    const source = Readable.from(this.sqlV2(pages, first.value));
    const gzip = createGzip();
    // Propagate failures and cancellation in either direction, including DB reads.
    pipeline(source, gzip, () => undefined);
    return gzip;
  }

  private async *sqlV2(pages: AsyncGenerator<Snapshot>, first: Snapshot) {
    const exportedAt = new Date().toISOString();
    const chunks: BatchDigest[] = [];
    const terms = new Map<number, Snapshot[number]['term']>();
    let count = 0;
    yield '-- DSPS CARE attendance archive v2 (MySQL / MariaDB, UTF-8)\n';
    yield '-- Historical snapshots only. Does not modify live attendance or scores.\n';
    yield 'SET NAMES utf8mb4;\n';
    yield 'CREATE TABLE IF NOT EXISTS `DSPSAttendanceArchive_v1` (`id` VARCHAR(191) NOT NULL PRIMARY KEY, `recordJson` LONGTEXT NOT NULL) CHARACTER SET utf8mb4;\n';
    yield 'START TRANSACTION;\n';
    let records = first;
    try {
      while (true) {
        const lines: string[] = [];
        for (const record of records) {
          terms.set(record.termId, record.term);
          const id = Buffer.from(record.id).toString('hex');
          const json = Buffer.from(JSON.stringify(record)).toString('hex');
          lines.push(
            `INSERT INTO \`DSPSAttendanceArchive_v1\` (\`id\`, \`recordJson\`) VALUES (CONVERT(X'${id}' USING utf8mb4), CONVERT(X'${json}' USING utf8mb4));`,
          );
        }
        const chunk = { count: records.length, digest: this.digest(records) };
        chunks.push(chunk);
        count += records.length;
        lines.push(`-- DSPS_ARCHIVE_BATCH ${chunk.count} ${chunk.digest}`);
        yield lines.join('\n') + '\n';
        const next = await pages.next();
        if (next.done) break;
        records = next.value;
      }
      const digest = this.chunksDigest(chunks);
      const termIds = [...terms.keys()].sort((a, b) => a - b);
      const manifest = {
        format: 'dsps-attendance-archive',
        version: 2,
        exportedAt,
        count,
        digest,
        receipt: this.receipt({ version: 2, termIds, digest, count }),
        terms: termIds.map((id) => terms.get(id)!),
        chunks: chunks.length,
      };
      yield 'COMMIT;\n';
      yield `-- DSPS_ARCHIVE_V2_END ${Buffer.from(JSON.stringify(manifest)).toString('base64')}\n`;
    } finally {
      await pages.return(undefined);
    }
  }

  async purge(token: string, actorId: string) {
    const receipt = this.verify(token);
    const termIds = [...new Set(receipt.termIds)].sort((a, b) => a - b);
    return this.prisma.$transaction(
      async (tx) => {
        for (const termId of termIds) await lockAttendanceTerm(tx, termId);
        const terms = await tx.academicTerm.findMany({
          where: { id: { in: termIds } },
        });
        const todayBangkok = new Date(Date.now() + 7 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        if (
          terms.length !== termIds.length ||
          terms.some(
            (term) =>
              term.isActive ||
              term.endDate.toISOString().slice(0, 10) >= todayBangkok,
          )
        ) {
          throw new BadRequestException(
            'ล้างได้เฉพาะภาคเรียนที่สิ้นสุดแล้วและไม่ได้ตั้งเป็นภาคเรียนปัจจุบัน',
          );
        }
        let count: number;
        let digest: string;
        if (receipt.version === 1) {
          const records = await this.snapshot(tx, termIds);
          count = records.length;
          digest = this.digest(records);
        } else {
          count = 0;
          const chunks: BatchDigest[] = [];
          for await (const records of this.pages(tx, termIds)) {
            count += records.length;
            chunks.push({
              count: records.length,
              digest: this.digest(records),
            });
          }
          digest = this.chunksDigest(chunks);
        }
        if (count !== receipt.count || digest !== receipt.digest) {
          throw new ConflictException(
            'ข้อมูลเปลี่ยนแปลงหลังส่งออก กรุณาส่งออกและตรวจไฟล์สำรองใหม่ก่อนล้าง',
          );
        }
        // Deliberately delete attendance only. BehaviorRecord, point accounts and
        // enrollment snapshots are the score ledger and MUST remain untouched.
        const deleted = await tx.attendanceRecord.deleteMany({
          where: { termId: { in: termIds } },
        });
        for (const termId of termIds) {
          await tx.systemConfig.update({
            where: { key: attendanceTermStateKey(termId) },
            data: {
              value: JSON.stringify({
                archivedAt: new Date().toISOString(),
                actorId,
                digest: receipt.digest,
              }),
            },
          });
        }
        return { deletedCount: deleted.count, termIds, scoresPreserved: true };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120000,
      },
    );
  }
}
