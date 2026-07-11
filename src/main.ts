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

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Smart School API - Behavior Services')
      .setDescription('คู่มือการใช้งาน API สำหรับระบบบันทึกคะแนนพฤติกรรมนักเรียน')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Swagger UI is running on: http://localhost:${port}/docs`);
  }
}
bootstrap();
