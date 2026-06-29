import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import 'dotenv/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // 1. แกะค่าต่างๆ ออกจาก DATABASE_URL ของเรา
    const dbUrl = new URL(process.env.DATABASE_URL as string);

    // 2. สร้าง Adapter สำหรับ MySQL/MariaDB โดยใส่ค่าที่แกะออกมา
    const adapter = new PrismaMariaDb({
      host: dbUrl.hostname,
      port: Number(dbUrl.port) || 3306,
      user: decodeURIComponent(dbUrl.username),
      password: decodeURIComponent(dbUrl.password),
      database: dbUrl.pathname.slice(1), // ตัดเครื่องหมาย / ด้านหน้าออก
    });

    // 3. ส่ง Adapter เข้าไปให้ PrismaClient
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
