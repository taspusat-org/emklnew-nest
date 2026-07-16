import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';
import { ZodError } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: any) {}

  async transform(value: any, metadata: ArgumentMetadata) {
    try {
      // Gunakan parseAsync untuk menangani validasi asinkron
      await this.schema.parseAsync(value); // Gantilah .parse menjadi .parseAsync
      return value;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException(error.errors);
      }
      throw error;
    }
  }
}
