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
import { BiayaExtraHeaderService } from './biaya-extra-header.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import {
  CreateBiayaExtraHeaderSchema,
  UpdateBiayaExtraHeaderDto,
  UpdateBiayaExtraHeaderSchema,
} from './dto/create-biaya-extra-header.dto';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ExportBiayaExtraHeaderDto,
  ExportBiayaExtraHeaderSchema,
} from './dto/export-biaya-extra-header.dto';
import {
  ReportBiayaExtraHeaderDto,
  ReportBiayaExtraHeaderSchema,
} from './dto/report-biaya-extra-header.dto';

@Controller('biayaextraheader')
export class BiayaExtraHeaderController {
  constructor(
    private readonly biayaExtraHeaderService: BiayaExtraHeaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@BIAYA-EXTRA-HEADER
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateBiayaExtraHeaderSchema),
      KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.biayaExtraHeaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating biaya extra header in controller',
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create biaya extra header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@BIAYA-EXTRA-HEADER
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
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.biayaExtraHeaderService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all biaya extra header ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch biaya extra header',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@BIAYA-EXTRA-HEADER
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdateBiayaExtraHeaderSchema),
    )
    data: UpdateBiayaExtraHeaderDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.biayaExtraHeaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating biaya extra header in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update biaya extra header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@BIAYA-EXTRA-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.biayaExtraHeaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting biaya extra header in controller:', error);
      throw new Error(
        `Error deleting biaya extra header in controller: ${error.message}`,
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
      const forceEdit = await this.biayaExtraHeaderService.checkValidasi(
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

  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportBiayaExtraHeaderSchema))
    body: ExportBiayaExtraHeaderDto,
  ) {
    const { search, filters, sortBy, sortDirection } = body;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    // Diresolusi di sini (async) karena ExportJobService meminta stream-nya
    // secara sinkron; grid selalu menampilkan satu jenis order saja.
    const jenisorderId = await this.biayaExtraHeaderService.resolveJenisOrderId(
      filters,
      dbMssql,
    );

    const queryParams = {
      search,
      filters: (filters ?? {}) as Record<string, string | number>,
      sort: {
        sortBy: sortBy || 'nobukti',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
      jenisorderId,
    };

    return this.exportJobService.start({
      filename: `laporan_biaya_extra_${stamp}.xlsx`,
      countRows: () =>
        this.biayaExtraHeaderService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.biayaExtraHeaderService
          .buildExportQuery(queryParams, dbMssql)
          .stream(),
      sheet: this.biayaExtraHeaderService.exportSheet,
    });
  }

  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportBiayaExtraHeaderSchema))
    body: ReportBiayaExtraHeaderDto,
    @Req() req,
  ) {
    const { mrtName, id, judullaporan } = body;
    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      loadData: () =>
        // Sengaja TANPA transaksi: pembacaan murni untuk laporan, dan job-nya
        // berumur panjang (render bisa menit-an).
        this.biayaExtraHeaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      const data = await this.findOne(id);

      if (!data.data && data?.data.length === 0) {
        throw new Error('Data is not found');
      }

      const tempFilePath =
        await this.biayaExtraHeaderService.exportToExcel(data);
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
  @Get('findOneDetail/:id')
  async findOneDetail(@Param('id') id: string, @Query() query: any) {
    const trx = await dbMssql.transaction();
    try {
      const { jenisOrderan } = query;
      // jenisOrderan adalah id bertipe text (UUID) — `+jenisOrderan` dulu
      // mengubahnya jadi NaN sebelum sampai ke service.
      const result = await this.biayaExtraHeaderService.findOneDetail(
        id,
        jenisOrderan,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne detail biaya extra:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Get('/detailByJob')
  async getDetailByJob(@Query() query: any) {
    const trx = await dbMssql.transaction();
    try {
      const { ...filters } = query;
      const result = await this.biayaExtraHeaderService.getDetailByJob(
        filters,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne detail biaya extra:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.biayaExtraHeaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne biaya extra header:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
