import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UsePipes,
  Query,
  Put,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { ParameterService } from './parameter.service';
import { CreateParameterSchema } from './dto/create-parameter.dto';
import { UpdateParameterSchema } from './dto/update-parameter.dto';
import {
  ReportParameterDto,
  ReportParameterSchema,
} from './dto/report-parameter.dto';
import {
  ExportParameterDto,
  ExportParameterSchema,
} from './dto/export-parameter.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { AuthGuard } from '../auth/auth.guard';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import { dbMssql } from 'src/common/utils/db';
import { Response } from 'express';
import * as fs from 'fs';

@Controller('parameter')
export class ParameterController {
  constructor(
    private readonly parameterService: ParameterService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body(
      new ZodValidationPipe(CreateParameterSchema),
      KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.parameterService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating parameter in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create parameter',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('report-byselect')
  async findAllByIds(@Body() ids: { id: string }[]) {
    return this.parameterService.findAllByIds(ids);
  }

  @Post('/export-byselect')
  async exportToExcelBySelect(
    @Body() ids: { id: string }[],
    @Res() res: Response,
  ) {
    try {
      const data = await this.parameterService.findAllByIds(ids);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.parameterService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_parameter.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Get()
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const {
      search,
      page,
      limit,
      sortBy,
      sortDirection,
      isLookUp,
      exclude,
      ...filters
    } = query;

    const sortParams = {
      sortBy: sortBy || 'grp',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    const params: FindAllParams = {
      search,
      filters,
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean
      exclude,
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    return this.parameterService.findAll(params);
  }

  @Get('approval')
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllApproval(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'grp',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    const params: FindAllParams = {
      search,
      filters,
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean

      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    return this.parameterService.findAllApproval(params);
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      // Mengambil data dari findAll dengan params
      const { data } = await this.findAll(params);
      // Cek apakah data ada dan merupakan array
      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      // Memanggil service untuk menghasilkan file Excel
      const tempFilePath = await this.parameterService.exportToExcel(data);

      // Buat header untuk response download
      const fileStream = fs.createReadStream(tempFilePath);

      // Set response headers for Excel file download
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_parameter.xlsx"',
      );

      // Pipe the file stream to the response
      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.parameterService.getById(id, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error fetching data by id:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to fetch data by id');
    }
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateParameterSchema))
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.parameterService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating parameter in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update parameter',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.parameterService.delete(
        id,
        trx,
        req.user?.user?.username,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting parameter in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete parameter');
    }
  }

  @UseGuards(AuthGuard)
  @Post('check-validation')
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;
    const trx = await dbMssql.transaction();

    try {
      const result = await this.parameterService.checkValidasi(
        aksi,
        value,
        req.user?.user?.username,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error checking validation parameter:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  /**
   * POST /parameter/report
   *
   * Cetak laporan di background. Request langsung balas { jobId }; progres
   * render dikirim lewat socket namespace `/report` (event `report:progress`,
   * room = jobId), dan PDF-nya diambil di GET /report/download/:jobId.
   *
   * Data laporan diambil lewat findAll() milik service ini dengan limit 0,
   * jadi filter kolom / search global / sort yang dikirim frontend berperilaku
   * persis sama seperti yang tampil di grid — hanya saja tanpa paging.
   */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportParameterSchema))
    body: ReportParameterDto,
    @Req() req,
  ) {
    const { mrtName, search, filters, sortBy, sortDirection, judullaporan } =
      body;

    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      loadData: async () => {
        // Sengaja TANPA transaksi: ini murni pembacaan untuk laporan, dan
        // job-nya berumur panjang (render bisa menit-an).
        const result = await this.parameterService.findAll({
          search,
          filters: (filters ?? {}) as Record<string, string | number>,
          // limit 0 = tanpa paging, ambil semua baris yang lolos filter.
          pagination: { page: 1, limit: 0 },
          sort: {
            sortBy: sortBy || 'grp',
            sortDirection: sortDirection || 'asc',
          },
          isLookUp: false,
        });

        const rows = Array.isArray(result?.data) ? result.data : [];

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const tglcetak =
          `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
          `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // Kolom tambahan di bawah dipakai header template .mrt.
        return rows.map((row: any) => ({
          ...row,
          // `default` adalah keyword C#, jadi tidak bisa ditulis sebagai
          // {data.default} di ekspresi template — pakai alias.
          defaultvalue: row.default,
          judullaporan: judullaporan ?? 'Laporan Parameter',
          usercetak: username,
          tglcetak,
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        }));
      },
    });
  }

  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportParameterSchema))
    body: ExportParameterDto,
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
        sortBy: sortBy || 'grp',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
    };

    return this.exportJobService.start({
      filename: `laporan_parameter_${stamp}.xlsx`,
      countRows: () =>
        this.parameterService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.parameterService.buildExportQuery(queryParams, dbMssql).stream(),
      sheet: this.parameterService.exportSheet,
    });
  }

  @Post('validate')
  async validateRows(@Body() body: { rows: { key: string; value: string }[] }) {
    try {
      const { rows } = body;

      if (!rows || !Array.isArray(rows)) {
        throw new BadRequestException('Invalid data format');
      }

      const validationResult = await this.parameterService.validateRows(rows);
      if (!validationResult.success) {
        return {
          status: false,
          errors: validationResult.errors,
          message: 'Validation completed with warnings.',
        };
      }

      return {
        status: true,
        message: 'Validation successful',
      };
    } catch (error) {
      console.error('Error validating rows:', error);
      throw new InternalServerErrorException('Internal server error');
    }
  }
}
