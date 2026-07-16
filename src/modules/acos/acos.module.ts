// acos.module.ts
import { Module } from '@nestjs/common';
import { AcosController } from './acos.controller';
import { AcosService } from './acos.service';
import { AuthModule } from '../auth/auth.module'; // Pastikan Anda mengimpor AuthModule
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [AuthModule, JwtModule], // Impor AuthModule agar bisa mengakses JwtService
  controllers: [AcosController],
  providers: [AcosService],
})
export class AcosModule {}
