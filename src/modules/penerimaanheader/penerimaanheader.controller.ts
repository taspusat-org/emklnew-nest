import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UsePipes,
  Query,
  Req,
  Put,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PenerimaanheaderService } from './penerimaanheader.service';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { Response } from 'express';
import * as fs from 'fs';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportPenerimaanheaderDto,
  ReportPenerimaanheaderSchema,
} from './dto/report-penerimaanheader.dto';
import {
  ExportPenerimaanheaderDto,
  ExportPenerimaanheaderSchema,
} from './dto/export-penerimaanheader.dto';
import {
  CreatePenerimaanheaderDto,
  CreatePenerimaanheaderSchema,
} from './dto/create-penerimaanheader.dto';
import {
  UpdatePenerimaanheaderDto,
  UpdatePenerimaanheaderSchema,
} from './dto/update-penerimaanheader.dto';

@Controller('penerimaanheader')
export class PenerimaanheaderController {
  constructor(
    private readonly penerimaanheaderService: PenerimaanheaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PENERIMAAN
  async create(
    @Body(new ZodValidationPipe(CreatePenerimaanheaderSchema))
    data: CreatePenerimaanheaderDto & Record<string, any>,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.penerimaanheaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      // HttpException diteruskan APA ADANYA. Membungkusnya jadi `new Error(...)`
      // membuang statusCode + pesannya, sehingga validasi 400 yang jelas
      // (mis. "BANK WAJIB DIISI") sampai ke user sebagai 500 generik.
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Error creating penerimaan:', error);
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
  //@PENERIMAAN
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: any) {
    // isreload dibuang di sini: sudah tak dipakai sejak findAll baca view,
    // tapi frontend masih mengirimnya dan tak boleh ikut jadi filter kolom
    // (`u.isreload` bukan kolom vpenerimaanheader -> query gagal).
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
    const trx = await dbMssql.transaction();

    try {
      const result = await this.penerimaanheaderService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@PENERIMAAN
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePenerimaanheaderSchema))
    data: UpdatePenerimaanheaderDto & Record<string, any>,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.penerimaanheaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      // HttpException diteruskan APA ADANYA. Membungkusnya jadi `new Error(...)`
      // membuang statusCode + pesannya, sehingga validasi 400 yang jelas
      // (mis. "BANK WAJIB DIISI") sampai ke user sebagai 500 generik.
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Error updating penerimaan:', error);
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
  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.penerimaanheaderService.delete(
        id,
        trx,
        req.user?.user?.username || 'unknown',
      );
      await trx.commit();

      return result;
    } catch (error) {
      await trx.rollback();
      // HttpException diteruskan APA ADANYA. Membungkusnya jadi `new Error(...)`
      // membuang statusCode + pesannya, sehingga validasi 400 yang jelas
      // (mis. "BANK WAJIB DIISI") sampai ke user sebagai 500 generik.
      if (error instanceof HttpException) {
        throw error;
      }
      console.error('Error deleting penerimaan:', error);
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
  @Get(':id')
  //@KAS-GANTUNG
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.penerimaanheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  /**
   * POST /penerimaanheader/report
   *
   * Cetak bukti penerimaan di background. Request langsung balas { jobId };
   * progres render dikirim lewat socket namespace `/report` (room = jobId), dan
   * PDF-nya diambil di GET /report/download/:jobId.
   *
   * Beda dengan laporan daftar yang mencetak seluruh baris hasil filter grid:
   * LaporanPenerimaan.mrt adalah bukti PER TRANSAKSI, jadi yang dikirim
   * frontend hanya id baris yang dicentang. Datanya dua tabel — `data` (header)
   * dan `detail` (rincian) — sesuai datasource template.
   */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportPenerimaanheaderSchema))
    body: ReportPenerimaanheaderDto,
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
        this.penerimaanheaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  /**
   * POST /penerimaanheader/export
   *
   * Export Excel SATU bukti penerimaan beserta rinciannya di background —
   * cakupannya sama dengan cetak bukti, bukan daftar seluruh baris grid.
   * Request langsung balas { jobId }; progresnya dikirim lewat socket namespace
   * `/report` (kanal yang sama dengan cetak laporan), dan file-nya diambil di
   * GET /report/download/:jobId.
   *
   * Sengaja TANPA transaksi: pembacaan murni untuk export, dan job-nya berumur
   * panjang. Membuka transaksi di sini hanya menahan koneksi database.
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportPenerimaanheaderSchema))
    body: ExportPenerimaanheaderDto,
  ) {
    const header = await this.penerimaanheaderService.loadExportBuktiHeader(
      body.id,
      dbMssql,
    );

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const nobukti = String(header.nobukti ?? '').replace(
      /[^A-Za-z0-9_-]+/g,
      '',
    );

    return this.exportJobService.start({
      filename: `penerimaan_${nobukti}_${stamp}.xlsx`,
      countRows: () =>
        this.penerimaanheaderService.countExportBuktiRows(
          header.nobukti,
          dbMssql,
        ),
      streamRows: () =>
        this.penerimaanheaderService
          .buildExportBuktiQuery(header.nobukti, dbMssql)
          .stream(),
      sheet: this.penerimaanheaderService.buildExportBuktiSheet(header),
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.penerimaanheaderService.findOne(id, trx);

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath = await this.penerimaanheaderService.exportToExcel(
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
        'attachment; filename="laporan_penerimaan.xlsx"',
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
}
