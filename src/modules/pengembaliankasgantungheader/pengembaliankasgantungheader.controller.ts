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
} from '@nestjs/common';

import { PengembaliankasgantungheaderService } from './pengembaliankasgantungheader.service';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportPengembaliankasgantungheaderDto,
  ReportPengembaliankasgantungheaderSchema,
} from './dto/report-pengembaliankasgantungheader.dto';
import {
  ExportPengembaliankasgantungheaderDto,
  ExportPengembaliankasgantungheaderSchema,
} from './dto/export-pengembaliankasgantungheader.dto';

@Controller('pengembaliankasgantungheader')
export class PengembaliankasgantungheaderController {
  constructor(
    private readonly pengembaliankasgantungheaderService: PengembaliankasgantungheaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PENGEMBALIAN-KAS-GANTUNG
  async create(@Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pengembaliankasgantungheaderService.create(
        data,
        trx,
      );
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();

      // PENTING: jangan bungkus HttpException dengan Error baru — statusCode
      // dan pesan validasinya hilang dan user selalu dapat 500 generik.
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
  //@PENGEMBALIAN-KAS-GANTUNG
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: any) {
    // isreload dibuang di sini: sudah tak dipakai sejak findAll baca view,
    // tapi frontend masih mengirimnya dan tak boleh ikut jadi filter kolom.
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
      const result = await this.pengembaliankasgantungheaderService.findAll(
        params,
        trx,
      );
      await trx.commit();

      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@PENGEMBALIAN-KAS-GANTUNG
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pengembaliankasgantungheaderService.update(
        id,
        data,
        trx,
      );

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
  //@PENGEMBALIAN-KAS-GANTUNG
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.pengembaliankasgantungheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting pengembaliankasgantungheader:', error);
      throw new Error(
        `Error deleting pengembaliankasgantungheader: ${error.message}`,
      );
    }
  }

  /**
   * POST /pengembaliankasgantungheader/report
   *
   * Cetak bukti pengembalian kas gantung di background. Request langsung balas
   * { jobId }; progres render dikirim lewat socket namespace `/report` (event
   * `report:progress`, room = jobId), dan PDF-nya diambil di
   * GET /report/download/:jobId.
   *
   * Beda dengan laporan daftar yang mencetak seluruh baris hasil filter grid:
   * LaporanPengembalianKasGantung.mrt adalah bukti PER TRANSAKSI, jadi yang
   * dikirim frontend hanya id baris yang dicentang. Datanya dua tabel — `data`
   * (header) dan `detail` (rincian) — sesuai datasource template.
   */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportPengembaliankasgantungheaderSchema))
    body: ReportPengembaliankasgantungheaderDto,
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
        this.pengembaliankasgantungheaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  /**
   * POST /pengembaliankasgantungheader/export
   *
   * Export Excel SATU bukti pengembalian kas gantung beserta rinciannya di
   * background — cakupannya sama dengan cetak bukti, bukan daftar seluruh
   * baris grid. Request langsung balas { jobId }; progresnya dikirim lewat
   * socket namespace `/report` (kanal yang sama dengan cetak laporan), dan
   * file-nya diambil di GET /report/download/:jobId.
   *
   * Sengaja TANPA transaksi: pembacaan murni untuk export, dan job-nya berumur
   * panjang. Membuka transaksi di sini hanya menahan koneksi database.
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportPengembaliankasgantungheaderSchema))
    body: ExportPengembaliankasgantungheaderDto,
  ) {
    const header =
      await this.pengembaliankasgantungheaderService.loadExportBuktiHeader(
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
      filename: `pengembalian_kas_gantung_${nobukti}_${stamp}.xlsx`,
      countRows: () =>
        this.pengembaliankasgantungheaderService.countExportBuktiRows(
          header.nobukti,
          dbMssql,
        ),
      streamRows: () =>
        this.pengembaliankasgantungheaderService
          .buildExportBuktiQuery(header.nobukti, dbMssql)
          .stream(),
      sheet:
        this.pengembaliankasgantungheaderService.buildExportBuktiSheet(header),
    });
  }

  @UseGuards(AuthGuard)
  @Post('check-validation')
  //@PENGEMBALIAN-KAS-GANTUNG
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;

    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;
    try {
      const forceEdit =
        await this.pengembaliankasgantungheaderService.checkValidasi(
          aksi,
          value,
          editedby,
          trx,
        );
      await trx.commit();
      return forceEdit;
    } catch (error) {
      await trx.rollback();
      console.error('Error checking validation:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  //@PENGEMBALIAN-KAS-GANTUNG
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.pengembaliankasgantungheaderService.findOne(
        id,
        trx,
      );
      await trx.commit();

      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
