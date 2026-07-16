import {
  Controller,
  Get,
  Post,
  Body,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { PrinterService } from './printer.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';

@Controller('printers')
export class PrinterController {
  constructor(private readonly printerService: PrinterService) {}

  // Endpoint untuk mendapatkan daftar printer
  @Get()
  getPrinters() {
    return this.printerService.getPrinters();
  }

  // Endpoint untuk print dokumen
  @Post('print')
  @UseInterceptors(FileInterceptor('file'))
  async printDocument(
    @UploadedFile() file: Express.Multer.File, // The uploaded file object
    @Body() body: { printerName: string }, // Other form data
  ) {
    const { printerName } = body;
    // Pass the file's buffer directly to the service
    return this.printerService.printFile(printerName, file.buffer);
  }
}
