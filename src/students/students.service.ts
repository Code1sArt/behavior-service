import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx';
import 'multer';
import {
  enrollmentDataForContext,
  requireClassroomAcademicContext,
} from './student-academic-context';
import { LineService } from '../line/line.service';

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private lineService: LineService,
  ) {}

  async create(dto: CreateStudentDto) {
    // 1. เช็คว่ามีผู้ใช้นี้อยู่แล้วหรือไม่
    const existing = await this.prisma.user.findUnique({
      where: { citizenId: dto.citizenId },
    });
    if (existing) throw new ConflictException('รหัสนักเรียนนี้มีในระบบแล้ว');

    // 2. Hash Password
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const classroomContext = await requireClassroomAcademicContext(
      this.prisma,
      dto.classroomId,
    );

    // 3. สร้าง User โดยระบุ Role เป็น STUDENT
    return this.prisma.user.create({
      data: {
        ...dto,
        password: hashedPassword,
        role: Role.STUDENT,
        pointAccount: {
          create: { initialPoints: classroomContext.startingPoints },
        },
        enrollments: {
          create: enrollmentDataForContext(classroomContext, new Date()),
        },
      },
      select: {
        id: true,
        citizenId: true,
        firstName: true,
        lastName: true,
        classroom: true,
      },
    });
  }

  async findAll(classroomId?: number | null) {
    const students = await this.prisma.user.findMany({
      where: {
        role: Role.STUDENT,
        ...(classroomId === null
          ? { classroomId: null }
          : classroomId !== undefined
            ? { classroomId }
            : {}),
      },
      select: {
        id: true,
        citizenId: true,
        firstName: true,
        lastName: true,
        classroomId: true,
        lineUserId: true,
        classroom: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return Promise.all(
      students.map(async (student) => ({
        ...student,
        isLineLinked: Boolean(student.lineUserId),
        linePictureUrl: student.lineUserId
          ? await this.lineService.getProfilePictureUrl(student.lineUserId)
          : null,
      })),
    );
  }

  async search(query: string, limit = 30) {
    const normalizedQuery = query?.trim() ?? '';

    if (limit < 1 || limit > 100) {
      throw new BadRequestException('limit ต้องอยู่ระหว่าง 1 ถึง 100');
    }

    const searchTerms = normalizedQuery.split(/\s+/);

    return this.prisma.user.findMany({
      where: {
        role: Role.STUDENT,
        ...(normalizedQuery && {
          AND: searchTerms.map((term) => ({
            OR: [
              { citizenId: { contains: term } },
              { firstName: { contains: term } },
              { lastName: { contains: term } },
            ],
          })),
        }),
      },
      take: limit,
      select: {
        id: true,
        citizenId: true,
        firstName: true,
        lastName: true,
        classroomId: true,
        classroom: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  async findOne(id: string) {
    const student = await this.prisma.user.findFirst({
      where: { id, role: Role.STUDENT },
      include: { classroom: true },
    });
    if (!student) throw new NotFoundException('ไม่พบข้อมูลนักเรียน');
    return student;
  }

  async update(id: string, dto: UpdateStudentDto) {
    const existingStudent = await this.findOne(id);

    const data = { ...dto };
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    const isMovingClassroom =
      dto.classroomId !== undefined &&
      dto.classroomId !== existingStudent.classroomId;
    if (!isMovingClassroom) {
      return this.prisma.user.update({
        where: { id },
        data,
      });
    }

    const targetContext = await requireClassroomAcademicContext(
      this.prisma,
      dto.classroomId as number,
    );
    const initialPoints =
      existingStudent.classroom?.startingPoints ?? targetContext.startingPoints;
    const movedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.studentPointAccount.upsert({
        where: { studentId: id },
        create: { studentId: id, initialPoints },
        update: {},
      });
      await tx.studentEnrollment.updateMany({
        where: { studentId: id, status: 'ACTIVE' },
        data: {
          status: 'ENDED',
          exitReason: 'TRANSFERRED',
          endedAt: movedAt,
        },
      });
      await tx.studentEnrollment.create({
        data: {
          studentId: id,
          ...enrollmentDataForContext(targetContext, movedAt),
        },
      });
      return tx.user.update({
        where: { id },
        data,
      });
    });
  }

  async remove(id: string) {
    const student = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      // Foreign keys ของตารางประวัติใช้ Restrict จึงต้องลบข้อมูลลูกก่อนลบบัญชี
      const attendance = await tx.attendanceRecord.deleteMany({
        where: {
          OR: [{ studentId: id }, { recorderId: id }],
        },
      });
      const behaviors = await tx.behaviorRecord.deleteMany({
        where: {
          OR: [{ studentId: id }, { recorderId: id }],
        },
      });
      const promotionItems = await tx.promotionItem.deleteMany({
        where: { studentId: id },
      });
      const enrollments = await tx.studentEnrollment.deleteMany({
        where: { studentId: id },
      });
      const pointAccounts = await tx.studentPointAccount.deleteMany({
        where: { studentId: id },
      });

      await tx.user.delete({ where: { id } });

      return {
        success: true,
        message: 'ลบนักเรียนและข้อมูลที่เกี่ยวข้องเรียบร้อยแล้ว',
        student: {
          id,
          name: `${student.firstName} ${student.lastName}`.trim(),
        },
        deleted: {
          attendanceRecords: attendance.count,
          behaviorRecords: behaviors.count,
          promotionItems: promotionItems.count,
          enrollments: enrollments.count,
          pointAccounts: pointAccounts.count,
        },
      };
    });
  }

  async importStudents(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('กรุณาอัปโหลดไฟล์ Excel');

    // 1. อ่านไฟล์จาก Buffer
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // 2. แปลงข้อมูลใน Sheet เป็น JSON
    // คาดหวัง Header ใน Excel: citizenId, firstName, lastName, password, classroomId
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];

    if (!rows.length) {
      throw new BadRequestException('ไม่พบข้อมูลนักเรียนในไฟล์ Excel');
    }

    const results = {
      success: 0,
      errors: [] as string[],
    };

    const normalizedRows = rows.map((row, index) => ({
      rowNumber: index + 2, // +2 เพราะแถวแรกเป็น Header ของ Excel
      citizenId: String(row.citizenId ?? '').trim(),
      firstName: String(row.firstName ?? '').trim(),
      lastName: String(row.lastName ?? '').trim(),
      password: row.password ? String(row.password) : '123456',
      classroomId: Number(row.classroomId),
    }));

    const invalidRowNumbers = new Set<number>();
    const citizenIdRows = new Map<string, number[]>();

    // 3. ตรวจสอบข้อมูลจำเป็น และเก็บตำแหน่ง citizenId เพื่อเช็คข้อมูลซ้ำในไฟล์
    for (const row of normalizedRows) {
      const missingFields: string[] = [];

      if (!row.citizenId) missingFields.push('citizenId');
      if (!row.firstName) missingFields.push('firstName');
      if (!row.lastName) missingFields.push('lastName');
      if (!row.classroomId || Number.isNaN(row.classroomId)) {
        missingFields.push('classroomId');
      }

      if (missingFields.length) {
        invalidRowNumbers.add(row.rowNumber);
        results.errors.push(
          `แถวที่ ${row.rowNumber}: ข้อมูลไม่ครบถ้วน (${missingFields.join(', ')})`,
        );
        continue;
      }

      const existingRows = citizenIdRows.get(row.citizenId) ?? [];
      existingRows.push(row.rowNumber);
      citizenIdRows.set(row.citizenId, existingRows);
    }

    // 4. ตรวจสอบ citizenId ซ้ำภายในไฟล์ Excel พร้อมระบุแถวที่ซ้ำ
    for (const [citizenId, rowNumbers] of citizenIdRows) {
      if (rowNumbers.length <= 1) continue;

      for (const rowNumber of rowNumbers) {
        invalidRowNumbers.add(rowNumber);
      }

      results.errors.push(
        `แถวที่ ${rowNumbers.join(', ')}: citizenId "${citizenId}" ซ้ำกันในไฟล์ Excel`,
      );
    }

    const citizenIds = [...citizenIdRows.keys()];
    const existingUsers = citizenIds.length
      ? await this.prisma.user.findMany({
          where: { citizenId: { in: citizenIds } },
          select: {
            citizenId: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];
    const existingUserMap = new Map(
      existingUsers.map((user) => [user.citizenId, user]),
    );

    // 5. ตรวจสอบ citizenId ซ้ำกับข้อมูลที่มีอยู่แล้วในระบบ
    for (const row of normalizedRows) {
      if (!row.citizenId) continue;

      const existingUser = existingUserMap.get(row.citizenId);
      if (!existingUser) continue;

      invalidRowNumbers.add(row.rowNumber);
      results.errors.push(
        `แถวที่ ${row.rowNumber}: citizenId "${row.citizenId}" ซ้ำกับข้อมูลในระบบ (${existingUser.firstName} ${existingUser.lastName})`,
      );
    }

    // 6. วนลูปบันทึกเฉพาะแถวที่ผ่านการตรวจสอบ
    for (const row of normalizedRows) {
      if (invalidRowNumbers.has(row.rowNumber)) continue;

      try {
        // เข้ารหัสผ่าน (ถ้าไม่มีในไฟล์ ให้ใช้เลขท้ายบัตรประชาชนหรือค่า Default)
        const hashedPassword = await bcrypt.hash(row.password, 10);
        const classroomContext = await requireClassroomAcademicContext(
          this.prisma,
          row.classroomId,
        );

        await this.prisma.user.create({
          data: {
            citizenId: row.citizenId,
            firstName: row.firstName,
            lastName: row.lastName,
            password: hashedPassword,
            role: Role.STUDENT,
            classroomId: row.classroomId,
            pointAccount: {
              create: { initialPoints: classroomContext.startingPoints },
            },
            enrollments: {
              create: enrollmentDataForContext(classroomContext, new Date()),
            },
          },
        });
        results.success++;
      } catch (error: any) {
        results.errors.push(
          `แถวที่ ${row.rowNumber} citizenId "${row.citizenId}": ${error.message}`,
        );
      }
    }

    return {
      message: 'ดำเนินการนำเข้าข้อมูลเสร็จสิ้น',
      ...results,
    };
  }
}
