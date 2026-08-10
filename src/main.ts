import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { ZodFilter } from './common/utils/zod-filter.exception';
import { SafeExceptionFilter } from './common/utils/safe-exception.filter';
import { LoggingMiddleware } from './common/middlewares/logging.middleware';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as express from 'express';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
// import { ThrottlerGuard } from '@nestjs/throttler';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
// import { swaggerConfig, buildSwaggerMetadata } from './swagger/swagger.config';
import { setupSwagger } from './swagger/swagger.config';

dotenv.config(); // Memuat file .env

async function bootstrap() {
  console.log('🚀 Starting NestJS application...');

  try {
    console.log('📦 Creating NestJS application...');
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    const uploadDir = path.join(process.cwd(), 'uploads', 'compress');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }

    console.log('🌐 Enabling CORS...');
    app.enableCors({
      origin: [
        'http://localhost:3001',
        'http://localhost:5000',
        '*',
        'http://192.168.3.211:3001',
        'http://192.168.3.21:3000',
        'http://localhost:3000',
        'http://localhost:3002',
        'http://localhost:5173',
        'http://192.168.3.217:3000',
        'http://100.91.135.37:3000',
      ], // List of allowed origins
      methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed methods
      allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
      // Tanpa ini browser menyembunyikan Content-Disposition dari response
      // lintas origin, sehingga frontend tidak bisa membaca nama file hasil
      // download (mis. export Excel di /report/download/:jobId).
      exposedHeaders: ['Content-Disposition'],
    });
    // main.ts
    setupSwagger(app);

    console.log('🔧 Setting up global filters and middleware...');
    // SafeExceptionFilter menyaring pesan driver/SQL dari body respons.
    app.useGlobalFilters(new ZodFilter(), new SafeExceptionFilter());
    app.use(
      '/uploads',
      express.static(path.join(process.cwd(), 'uploads/compress')),
    );
    // const microservice = app.connectMicroservice<MicroserviceOptions>({
    //   transport: Transport.RMQ,
    //   options: {
    //     urls: ['amqp://admin:admin@54.151.162.192:5672'], // URL RabbitMQ
    //     queue: 'hr_queue_dev', // Nama queue yang akan digunakan
    //     queueOptions: {
    //       durable: true, // Menetapkan queue untuk bertahan setelah restart
    //     },
    //   },
    // });

    app.use(new LoggingMiddleware().use);
    app.useWebSocketAdapter(new IoAdapter(app));

    const port = (process.env.PORT as unknown as number) ?? 3000;

    console.log(`🎧 Starting server on port ${port}...`);
    // Start all microservices before the main application server
    // await microservice.listen();
    await app.listen(port);

    console.log(`✅ Application is running on: http://localhost:${port}`);
    console.log(`✅ Server successfully started!`);
  } catch (error) {
    console.error('❌ Error during bootstrap:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

void bootstrap();
