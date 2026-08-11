import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  UsePipes,
  Query,
  NotFoundException,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from 'src/modules/auth/auth.guard';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { PanjarheaderService } from './panjarheader.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';

import {
  CreatePanjarHeaderSchema,
  UpdatePanjarHeaderSchema,
  UpdatePanjarheaderDto,
} from './dto/create-panjarheader.dto';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportPanjarheaderDto,
  ReportPanjarheaderSchema,
} from './dto/report-panjarheader.dto';
import {
  ExportPanjarheaderDto,
  ExportPanjarheaderSchema,
} from './dto/export-panjarheader.dto';

@Controller('panjarheader')
export class PanjarheaderController {
  constructor(
    private readonly panjarheaderService: PanjarheaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PANJAR-HEADER
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreatePanjarHeaderSchema),
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.panjarheaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating panjar header in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create panjar header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@PANJAR-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };

    // ZodValidationPipe memvalidasi tapi memulangkan value ASLI, jadi page &
    // limit di sini masih string dari query string. Tanpa Number(), knex
    // menerima .limit('50') dan offset dihitung lewat koersi JS yang kebetulan
    // benar — eksplisit saja supaya windowed pagination tidak bergantung koersi.
    const numericLimit = Number(limit);
    const pagination = {
      page: Number(page) || 1,
      limit:
        !numericLimit || Number.isNaN(numericLimit) ? undefined : numericLimit,
    };

    const params: FindAllParams = {
      search,
      filters,
      pagination,
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.panjarheaderService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all biaya panjar header ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch biaya panjar header',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@PANJAR-HEADER
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdatePanjarHeaderSchema),
    )
    data: UpdatePanjarheaderDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.panjarheaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating biaya panjar header in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update panjar header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@PANJAR-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.panjarheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting biaya panjar header in controller:', error);
      throw new Error(
        `Error deleting biaya panjar header in controller: ${error.message}`,
      );
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.panjarheaderService.checkValidasi(
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

  /**
   * POST /panjarheader/report
   *
   * Cetak laporan di background. Request langsung balas { jobId }; progres
   * render dikirim lewat socket namespace `/report` (event `report:progress`,
   * room = jobId), dan PDF-nya diambil di GET /report/download/:jobId.
   *
   * Data laporan diambil lewat findOne() milik service ini — hasilnya sudah
   * BARIS DATAR (header di-join ke muatan detail), bentuk yang diharapkan
   * LaporanPanjar.mrt dan yang dulu dirakit di browser.
   */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportPanjarheaderSchema))
    body: ReportPanjarheaderDto,
    @Req() req,
  ) {
    const { mrtName, id, judullaporan } = body;

    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      loadData: async () => {
        const trx = await dbMssql.transaction();
        let result: any;
        try {
          result = await this.panjarheaderService.findOne(String(id), trx);
          await trx.commit();
        } catch (error) {
          await trx.rollback();
          throw error;
        }

        const rows = Array.isArray(result?.data) ? result.data : [];

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const tglcetak =
          `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
          `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // Kolom tambahan di bawah dipakai header template .mrt.
        return rows.map((row: any) => ({
          ...row,
          judullaporan: judullaporan ?? 'PT. TRANSPORINDO AGUNG SEJAHTERA',
          usercetak: username,
          tglcetak,
          judul: 'LAPORAN PANJAR',
        }));
      },
    });
  }

  /**
   * POST /panjarheader/export
   *
   * Export Excel di background. Request langsung balas { jobId }; progresnya
   * dikirim lewat socket namespace `/report` (kanal yang sama dengan cetak
   * laporan), dan file-nya diambil di GET /report/download/:jobId.
   *
   * Barisnya di-stream lewat cursor, bukan ditampung di array — export bisa
   * menyentuh ratusan ribu baris.
   *
   * jenisorder_id diresolve DI SINI (bukan di dalam query) karena streamRows
   * dipanggil secara sinkron oleh ExportJobService, sedangkan resolusinya
   * butuh query lookup saat filter jenis orderan kosong (default MUATAN).
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportPanjarheaderSchema))
    body: ExportPanjarheaderDto,
  ) {
    const { search, filters, sortBy, sortDirection } = body;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const jenisOrderId =
      await this.panjarheaderService.resolveExportJenisOrderId(
        dbMssql,
        filters?.jenisOrderan,
      );

    const queryParams = {
      search,
      filters: (filters ?? {}) as Record<string, string | number>,
      sort: {
        sortBy: sortBy || 'nobukti',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
      jenisOrderId,
    };

    return this.exportJobService.start({
      filename: `laporan_panjar_${stamp}.xlsx`,
      countRows: () =>
        this.panjarheaderService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.panjarheaderService
          .buildExportQuery(queryParams, dbMssql)
          .stream(),
      sheet: this.panjarheaderService.exportSheet,
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      const data = await this.findOne(id);

      if (!data.data && data?.data.length === 0) {
        throw new Error('Data is not found');
      }

      const tempFilePath = await this.panjarheaderService.exportToExcel(data);
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_panjar.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.panjarheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne biaya extra header:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
