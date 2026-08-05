import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UsePipes,
  UseGuards,
  Req,
  Put,
  InternalServerErrorException,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { HutangheaderService } from './hutangheader.service';
import { CreateHutangheaderDto } from './dto/create-hutangheader.dto';
import { UpdateHutangheaderDto } from './dto/update-hutangheader.dto';
import {
  FindAllDto,
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
  ReportHutangheaderDto,
  ReportHutangheaderSchema,
} from './dto/report-hutangheader.dto';
import {
  ExportHutangheaderDto,
  ExportHutangheaderSchema,
} from './dto/export-hutangheader.dto';

@Controller('hutangheader')
export class HutangheaderController {
  constructor(
    private readonly hutangheaderService: HutangheaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body()
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.hutangheaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('error', error);
      throw new Error(`Error: ${error.message}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get()
  //@HUTANG
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

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
      const result = await this.hutangheaderService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  //@HUTANG
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.hutangheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@HUTANG
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.hutangheaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating hutang in controller:', error);
      throw new Error('Failed to update menu');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@HUTANG
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.hutangheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting hutang:', error);
      throw new Error(`Error deleting hutang: ${error.message}`);
    }
  }

  /**
   * POST /hutangheader/report
   *
   * Cetak bukti hutang di background. Request langsung balas { jobId }; progres
   * render dikirim lewat socket namespace `/report` (event `report:progress`,
   * room = jobId), dan PDF-nya diambil di GET /report/download/:jobId.
   *
   * Beda dengan laporan daftar (mis. Group Biaya Extra) yang mencetak seluruh
   * baris hasil filter grid: LaporanHutang.mrt adalah bukti PER TRANSAKSI, jadi
   * yang dikirim frontend hanya id baris yang dicentang. Datanya dua tabel —
   * `data` (header) dan `detail` (rincian) — sesuai datasource template.
   */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportHutangheaderSchema))
    body: ReportHutangheaderDto,
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
        this.hutangheaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  /**
   * POST /hutangheader/export
   *
   * Export Excel daftar hutang di background. Request langsung balas { jobId };
   * progresnya dikirim lewat socket namespace `/report` (kanal yang sama dengan
   * cetak laporan), dan file-nya diambil di GET /report/download/:jobId.
   *
   * Barisnya di-stream lewat cursor, bukan ditampung di array — export bisa
   * menyentuh ratusan ribu baris. Jangan disamakan dengan GET /export/:id di
   * bawah: yang itu mengekspor SATU bukti beserta rinciannya, yang ini seluruh
   * baris yang lolos filter grid.
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportHutangheaderSchema))
    body: ExportHutangheaderDto,
  ) {
    const { search, filters, sortBy, sortDirection } = body;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const queryParams = {
      search,
      filters: (filters ?? {}) as Record<string, string | number>,
      sort: {
        sortBy: sortBy || 'nobukti',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
    };

    return this.exportJobService.start({
      filename: `laporan_hutang_${stamp}.xlsx`,
      countRows: () =>
        this.hutangheaderService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.hutangheaderService.buildExportQuery(queryParams, dbMssql).stream(),
      sheet: this.hutangheaderService.exportSheet,
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.hutangheaderService.findOne(id, trx);

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath = await this.hutangheaderService.exportToExcel(
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
        'attachment; filename="laporan_hutang.xlsx"',
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
