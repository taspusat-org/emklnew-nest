import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UsePipes,
  UseGuards,
  Req,
  Put,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';

import { KasgantungheaderService } from './kasgantungheader.service';
import {
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { Response } from 'express';
import * as fs from 'fs';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportKasgantungheaderDto,
  ReportKasgantungheaderSchema,
} from './dto/report-kasgantungheader.dto';
import {
  ExportKasgantungheaderDto,
  ExportKasgantungheaderSchema,
} from './dto/export-kasgantungheader.dto';

@Controller('kasgantungheader')
export class KasgantungheaderController {
  constructor(
    private readonly kasgantungheaderService: KasgantungheaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@KAS-GANTUNG
  async create(@Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.kasgantungheaderService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();

      // PENTING: Jangan wrap HttpException dengan Error baru
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Get()
  //@KAS-GANTUNG
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: any) {
    // isreload dibuang di sini: tidak dipakai findAll, tapi frontend masih
    // mengirimnya dan tak boleh ikut jadi filter kolom.
    const {
      search,
      page,
      limit,
      sortBy,
      sortDirection,
      isLookUp,
      isreload,
      ...filters
    } = query;

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1,
      limit: limit === 0 || !limit ? undefined : limit,
    };

    const params: FindAllParams = {
      search,
      filters,
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true',
    };
    // Endpoint baca: TANPA transaksi, lihat alatbayar.controller.ts.
    return this.kasgantungheaderService.findAll(params, dbMssql);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@KAS-GANTUNG
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.kasgantungheaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@KAS-GANTUNG
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.kasgantungheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting kasgantungheader:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  @Get('list')
  //@KAS-GANTUNG
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllKasgantung(@Query() query: { dari: string; sampai: string }) {
    const { dari, sampai } = query;
    const trx = await dbMssql.transaction();

    try {
      const result = await this.kasgantungheaderService.getKasGantung(
        dari,
        sampai,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAllKasgantung:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Get('pengembalian')
  //@KAS-GANTUNG
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllPengembalian(
    @Query() query: { id: any; dari: string; sampai: string },
  ) {
    const { dari, sampai, id } = query;
    const trx = await dbMssql.transaction();

    try {
      const result = await this.kasgantungheaderService.getPengembalian(
        id,
        dari,
        sampai,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAllPengembalian:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  //@KAS-GANTUNG
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.kasgantungheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportKasgantungheaderSchema))
    body: ReportKasgantungheaderDto,
    @Req() req,
  ) {
    const { mrtName, id, judullaporan } = body;
    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      loadData: () =>
        // Sengaja TANPA transaksi: pembacaan murni untuk laporan, dan job-nya
        // berumur panjang (render bisa menit-an). Membuka transaksi di sini
        // hanya menahan koneksi database lebih lama tanpa manfaat konsistensi.
        this.kasgantungheaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportKasgantungheaderSchema))
    body: ExportKasgantungheaderDto,
  ) {
    const header = await this.kasgantungheaderService.loadExportBuktiHeader(
      body.id,
      dbMssql,
    );

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const nobukti = String(header.nobukti ?? '').replace(/[^A-Za-z0-9_-]+/g, '');

    return this.exportJobService.start({
      filename: `kas_gantung_${nobukti}_${stamp}.xlsx`,
      countRows: () =>
        this.kasgantungheaderService.countExportBuktiRows(
          header.nobukti,
          dbMssql,
        ),
      streamRows: () =>
        this.kasgantungheaderService
          .buildExportBuktiQuery(header.nobukti, dbMssql)
          .stream(),
      sheet: this.kasgantungheaderService.buildExportBuktiSheet(header),
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.kasgantungheaderService.findOne(id, trx);

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath = await this.kasgantungheaderService.exportToExcel(
        data,
        trx,
      );

      // Stream file ke response
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_kasgantung.xlsx"',
      );

      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);

      // Optional: hapus file temp setelah selesai streaming
      fileStream.on('end', () => {
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error('Error deleting temp file:', err);
        });
      });
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Failed to export file');
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;

    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;
    try {
      const forceEdit = await this.kasgantungheaderService.checkValidasi(
        aksi,
        value,
        editedby,
        trx,
      );
      trx.commit();
      return forceEdit;
    } catch (error) {
      trx.rollback();
      console.error('Error checking validation:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }
}
