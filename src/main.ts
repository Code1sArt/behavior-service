import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
  }));

  app.enableCors();
  // เปิดใช้งาน Validation ทั่วทั้งโปรเจกต์
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // จะตัด Field ที่ไม่ได้อยู่ใน DTO ทิ้งอัตโนมัติ
  }));

  // ==========================================
  // ตั้งค่า Swagger
  // ==========================================
  const config = new DocumentBuilder()
    .setTitle('Smart School API - Behavior Services')
    .setDescription('คู่มือการใช้งาน API สำหรับระบบบันทึกคะแนนพฤติกรรมนักเรียน')
    .setVersion('1.0')
    .addBearerAuth() // เปิดปุ่มให้ใส่ Token JWT ได้
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // เปิดหน้า Document ที่ URL: http://localhost:3000/docs
  SwaggerModule.setup('docs', app, document);
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:3000`);
  console.log(`Swagger UI is running on: http://localhost:3000/docs`);
}
bootstrap();
