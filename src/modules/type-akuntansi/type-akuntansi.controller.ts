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
import { AuthGuard } from '../auth/auth.guard';
import { isRecordExist } from 'src/utils/utils.service';
import { TypeAkuntansiService } from './type-akuntansi.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import {
  CreateTypeAkuntansiDto,
  CreateTypeAkuntansiSchema,
  CreateTypeAkuntansiSwaggerDto,
  UpdateTypeAkuntansiDto,
  UpdateTypeAkuntansiSchema,
} from './dto/create-type-akuntansi.dto';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { AclGuard } from '../auth/acl.guard';
import { RequireAcos } from '../auth/access.decorator';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportTypeAkuntansiDto,
  ReportTypeAkuntansiSchema,
} from './dto/report-type-akuntansi.dto';
import {
  ExportTypeAkuntansiDto,
  ExportTypeAkuntansiSchema,
} from './dto/export-type-akuntansi.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiHeader,
  ApiBearerAuth,
  ApiExtraModels,
} from '@nestjs/swagger';

@Controller('type-akuntansi')
export class TypeAkuntansiController {
  constructor(
    private readonly typeAkuntansiService: TypeAkuntansiService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Create A New TypeAkuntansi Data' })
  @Post()
  //@TYPE-AKUNTANSI
  @ApiTags('TypeAkuntansi')
  @ApiExtraModels()
  @ApiOperation({
    summary: 'Create Type Akuntansi',
    description: 'AAA',
  })
  @ApiBearerAuth()
  @ApiBody({ type: CreateTypeAkuntansiSwaggerDto })
  @ApiResponse({ status: 200, description: 'Create New TypeAkuntansi Data' })
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateTypeAkuntansiSchema),
    )
    data: CreateTypeAkuntansiDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.typeAkuntansiService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating type akuntansi in controller', error);

      // Ensure any other errors get caught and returned
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create type akuntansi',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @UseGuards(AuthGuard, AclGuard)
  //@TYPE-AKUNTANSI
  @ApiOperation({ summary: 'GET ALL TYPE AKUNTANSI' })
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description: 'Must return all TypeAkuntansi data',
  })
  // @ApiParam({ name: 'id', type: Number })
  @RequireAcos({ action: 'GET', subject: 'type-akuntansi' })
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
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.typeAkuntansiService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all type akuntansi ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch type akuntansi');
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@TYPE-AKUNTANSI
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdateTypeAkuntansiSchema),
    )
    data: UpdateTypeAkuntansiDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      // id = varchar UUID, JANGAN dikonversi ke number (+id -> NaN). Sumber
      // kebenaran adalah path param, bukan `id` di body.
      const result = await this.typeAkuntansiService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating type akuntansi in controller:',
        error,
      );

      // Ensure any other errors get caught and returned
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update type akuntansi',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@TYPE-AKUNTANSI
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.typeAkuntansiService.delete(
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
      console.error('Error deleting data in controller: ', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;

    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.typeAkuntansiService.checkValidasi(
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
   * POST /type-akuntansi/report
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
    @Body(new ZodValidationPipe(ReportTypeAkuntansiSchema))
    body: ReportTypeAkuntansiDto,
    @Req() req,
  ) {
    const { mrtName, search, filters, sortBy, sortDirection, judullaporan } =
      body;

    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      loadData: async () => {
        // Sengaja TANPA transaksi: ini murni pembacaan untuk laporan, dan
        // job-nya berumur panjang (render bisa menit-an). Membuka transaksi
        // di sini hanya menahan koneksi ke database remote lebih lama tanpa
        // manfaat konsistensi apa pun. `findAll` cukup menerima instance knex
        // karena hanya memakai API baca (from/raw/count).
        const result = await this.typeAkuntansiService.findAll(
          {
            search,
            filters: (filters ?? {}) as Record<string, string | number>,
            // limit 0 = tanpa paging, ambil semua baris yang lolos filter.
            pagination: { page: 1, limit: 0 },
            sort: {
              sortBy: sortBy || 'nama',
              sortDirection: sortDirection || 'asc',
            },
            isLookUp: false,
          },
          dbMssql,
        );

        const rows = Array.isArray(result?.data) ? result.data : [];

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const tglcetak =
          `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
          `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // Kolom tambahan di bawah dipakai header template .mrt.
        return rows.map((row: any) => ({
          ...row,
          judullaporan: judullaporan ?? 'Laporan Type Akuntansi',
          usercetak: username,
          tglcetak,
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        }));
      },
    });
  }

  /**
   * POST /type-akuntansi/export
   *
   * Export Excel di background. Request langsung balas { jobId }; progresnya
   * dikirim lewat socket namespace `/report` (kanal yang sama dengan cetak
   * laporan), dan file-nya diambil di GET /report/download/:jobId.
   *
   * Barisnya di-stream lewat cursor, bukan ditampung di array — export bisa
   * menyentuh ratusan ribu baris.
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportTypeAkuntansiSchema))
    body: ExportTypeAkuntansiDto,
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
      filename: `laporan_type_akuntansi_${stamp}.xlsx`,
      countRows: () =>
        this.typeAkuntansiService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.typeAkuntansiService
          .buildExportQuery(queryParams, dbMssql)
          .stream(),
      sheet: this.typeAkuntansiService.exportSheet,
    });
  }

  // Jalur blob lama, MASIH DIPAKAI tombol Export di halaman /reports/typeakuntansi
  // dan /reports/akunpusat (viewer PDF tab terpisah). Grid sudah pindah ke
  // POST /export di atas.
  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined');
      }

      const tempFilePath = await this.typeAkuntansiService.exportToExcel(data);
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_typeakuntansi.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  // @Post('/export-byselect')
  // async exportToExcelBySelect(
  //   @Body() ids: {id: number }[],
  //   @Res() res: Response
  // ) {
  //   try {
  //     const data = await this.typeAkuntansiService.findAllByIds(ids);

  //     if (!Array.isArray(data)) {
  //       throw new Error('Data is not an array or is undefined')
  //     }

  //     const tempFilePath = await this.typeAkuntansiService.exportToExcel(data);
  //     const fileStream = fs.createReadStream(tempFilePath);

  //     res.setHeader(
  //       'Content-Type',
  //       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  //     )
  //     res.setHeader(
  //       'Content-Disposition',
  //       'attachment; filename="laporan_typeakuntansi.xlsx"'
  //     )

  //     fileStream.pipe(res);
  //   } catch (error) {
  //     console.error('Error exporting to Excel:', error);
  //     res.status(500).send('Failed to export file');
  //   }
  // }

  // @Post('/report-byselect')
  // async findAllByIds(
  //   @Body() ids: { id: string }[]
  // ) {
  //   return this.typeAkuntansiService.findAllByIds(ids);
  // }
}
