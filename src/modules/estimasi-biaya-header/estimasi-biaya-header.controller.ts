import {
  Controller,
  Get,
  Res,
  Req,
  Put,
  Post,
  Body,
  Param,
  Query,
  Delete,
  UsePipes,
  UseGuards,
  HttpStatus,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { EstimasiBiayaHeaderService } from './estimasi-biaya-header.service';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import {
  CreateEstimasiBiayaHeaderSchema,
  UpdateEstimasiBiayaHeaderDto,
  UpdateEstimasiBiayaHeaderSchema,
} from './dto/create-estimasi-biaya-header.dto';
import { ExportJobService } from 'src/common/report/export-job.service';
import { ReportJobService } from 'src/common/report/report-job.service';
import {
  ReportEstimasiBiayaHeaderDto,
  ReportEstimasiBiayaHeaderSchema,
} from './dto/report-estimasi-biaya-header.dto';
import {
  ExportEstimasiBiayaHeaderDto,
  ExportEstimasiBiayaHeaderSchema,
} from './dto/export-estimasi-biaya-header.dto';

@Controller('estimasibiayaheader')
export class EstimasiBiayaHeaderController {
  constructor(
    private readonly estimasiBiayaHeaderService: EstimasiBiayaHeaderService,
    private readonly exportJobService: ExportJobService,
    private readonly reportJobService: ReportJobService,
  ) {}

  @UseGuards(AuthGuard)
  /** Cetak LaporanEstimasiBiaya.mrt di background; PDF diambil di GET /report/download/:jobId. */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportEstimasiBiayaHeaderSchema))
    body: ReportEstimasiBiayaHeaderDto,
    @Req() req,
  ) {
    const { mrtName, id, judullaporan } = body;
    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      // Tanpa transaksi: pembacaan murni, dan job render bisa lama.
      loadData: () =>
        this.estimasiBiayaHeaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportEstimasiBiayaHeaderSchema))
    body: ExportEstimasiBiayaHeaderDto,
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
      filename: `laporan_estimasibiaya_${stamp}.xlsx`,
      countRows: () =>
        this.estimasiBiayaHeaderService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.estimasiBiayaHeaderService
          .buildExportQuery(queryParams, dbMssql)
          .stream(),
      sheet: this.estimasiBiayaHeaderService.exportSheet,
    });
  }

  @UseGuards(AuthGuard)
  @Post()
  //@ESTIMASI-BIAYA-HEADER
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateEstimasiBiayaHeaderSchema),
      KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.estimasiBiayaHeaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating estimasi biaya header in controller',
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create estimasi biaya header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@ESTIMASI-BIAYA-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    // customOffset WAJIB ikut di-destructure. Sisa query masuk ke `...filters`
    // dan diperlakukan sebagai filter kolom — kalau tidak dikeluarkan di sini,
    // grid akan memfilter kolom bernama "customOffset" yang tidak ada.
    const {
      search,
      page,
      limit,
      sortBy,
      sortDirection,
      isLookUp,
      customOffset,
      ...filters
    } = query as typeof query & { customOffset?: string | number };

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };

    const offsetAngka = Number(customOffset);
    const pagination = {
      page: page || 1,
      limit: limit === 0 || !limit ? undefined : limit,
      customOffset:
        customOffset !== undefined &&
        Number.isFinite(offsetAngka) &&
        offsetAngka >= 0
          ? offsetAngka
          : undefined,
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
      const result = await this.estimasiBiayaHeaderService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all estimasi biaya header ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch estimasi biaya header',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@ESTIMASI-BIAYA-HEADER
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdateEstimasiBiayaHeaderSchema),
    )
    data: UpdateEstimasiBiayaHeaderDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.estimasiBiayaHeaderService.update(
        id,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating estimasi biaya header in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update estimasi biaya header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@ESTIMASI-BIAYA-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.estimasiBiayaHeaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error deleting estimasi biaya header in controller:',
        error,
      );
      throw new Error(
        `Error deleting estimasi biaya header in controller: ${error.message}`,
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
      const forceEdit = await this.estimasiBiayaHeaderService.checkValidasi(
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

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      const data = await this.findOne(id);

      if (data?.data.header.length === 0) {
        throw new Error('Data is not found');
      }

      const tempFilePath = await this.estimasiBiayaHeaderService.exportToExcel(
        data.data,
      );
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_biaya_extra.xlsx"',
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
      const result = await this.estimasiBiayaHeaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne estimasi biaya header:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
