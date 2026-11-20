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
import { PelayaranService } from './pelayaran.service';
import {
  CreatePelayaranDto,
  CreatePelayaranSchema,
} from './dto/create-pelayaran.dto';
import {
  UpdatePelayaranDto,
  UpdatePelayaranSchema,
} from './dto/update-pelayaran.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { Response } from 'express';
import * as fs from 'fs';
import { ExportJobService } from 'src/common/report/export-job.service';
import { ReportJobService } from 'src/common/report/report-job.service';
import {
  ExportPelayaranDto,
  ExportPelayaranSchema,
} from './dto/export-pelayaran.dto';
import {
  ReportPelayaranDto,
  ReportPelayaranSchema,
} from './dto/report-pelayaran.dto';
@Controller('pelayaran')
export class PelayaranController {
  constructor(
    private readonly pelayaranService: PelayaranService,
    private readonly exportJobService: ExportJobService,
    private readonly reportJobService: ReportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PELAYARAN
  async create(
    @Body(
      new ZodValidationPipe(CreatePelayaranSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreatePelayaranDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pelayaranService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating pelayaran in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create pelayaran',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@PELAYARAN
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nama',
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
    // Endpoint baca: TANPA transaksi. Transaksi menahan satu koneksi pool
    // selama seluruh request; dengan pool max 30 dan grid yang menembak banyak
    // lookup sekaligus, pool habis dan semua request lain kena
    // 'Timeout acquiring a connection'. dbMssql melepas koneksi per query.
    return this.pelayaranService.findAll(params, dbMssql);
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  //@PELAYARAN
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdatePelayaranSchema))
    data: UpdatePelayaranDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pelayaranService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating pelayaran in controller:', error);

      if (error instanceof HttpException) throw error;

      const lockTimeout =
        error?.number === 1222 ||
        error?.originalError?.info?.number === 1222 ||
        /lock request time out/i.test(error?.message ?? '');

      if (lockTimeout) {
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: 'Data sedang diproses transaksi lain, silakan coba lagi.',
          },
          HttpStatus.CONFLICT,
        );
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to Update pelayaran',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @UseGuards(AuthGuard)
  @Delete(':id')

  //@PELAYARAN
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.pelayaranService.delete(
        id,
        trx,
        req.user?.user?.username,
      );

      if (result.status === 404) {
        throw new NotFoundException(result.message);
      }

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting pelayaran in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete pelayaran');
    }
  }

  /** Cetak LaporanPelayaran.mrt di background; PDF diambil di GET /report/download/:jobId. */
  @UseGuards(AuthGuard)
  @Post('report')
  //@PELAYARAN
  async report(
    @Body(new ZodValidationPipe(ReportPelayaranSchema))
    body: ReportPelayaranDto,
    @Req() req,
  ) {
    const { mrtName, search, filters, sortBy, sortDirection, judullaporan } =
      body;
    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      // Tanpa transaksi: pembacaan murni, dan job render bisa lama.
      loadData: () =>
        this.pelayaranService.loadReportData(
          {
            search,
            filters: (filters ?? {}) as Record<string, string | number>,
            sort: {
              sortBy: sortBy || 'nama',
              sortDirection: sortDirection || 'asc',
            },
          },
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportPelayaranSchema))
    body: ExportPelayaranDto,
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
        sortBy: sortBy || 'nama',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
    };

    return this.exportJobService.start({
      filename: `laporan_pelayaran_${stamp}.xlsx`,
      countRows: () =>
        this.pelayaranService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.pelayaranService.buildExportQuery(queryParams, dbMssql).stream(),
      sheet: this.pelayaranService.exportSheet,
    });
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.pelayaranService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_pelayaran.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
