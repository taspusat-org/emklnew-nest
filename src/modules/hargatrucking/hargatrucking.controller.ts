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
  InternalServerErrorException,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { HargatruckingService } from './hargatrucking.service';
import {
  CreateHargatruckingDto,
  CreateHargatruckingSchema,
} from './dto/create-hargatrucking.dto';
import {
  UpdateHargatruckingDto,
  UpdateHargatruckingSchema,
} from './dto/update-hargatrucking.dto';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { isRecordExist } from 'src/utils/utils.service';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';
import { any } from 'zod';
import { Response } from 'express';
import * as fs from 'fs';
import { ReportJobService } from 'src/common/report/report-job.service';
import {
  ReportHargatruckingDto,
  ReportHargatruckingSchema,
} from './dto/report-hargatrucking.dto';
import {
  ExportHargatruckingDto,
  ExportHargatruckingSchema,
} from './dto/export-hargatrucking.dto';
import { ExportJobService } from 'src/common/report/export-job.service';

@Controller('hargatrucking')
export class HargatruckingController {
  constructor(
    private readonly hargatruckingService: HargatruckingService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@HARGA-TRUCKING
  async create(
    @Body(
      new ZodValidationPipe(CreateHargatruckingSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateHargatruckingDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.hargatruckingService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating harga trucking in controller', error);

      // Ensure any other errors get caught and returned
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create harga trucking',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@HARGA-TRUCKING
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'emkl_text',
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
      const result = await this.hargatruckingService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  //@HARGA-TRUCKING
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateHargatruckingSchema))
    data: UpdateHargatruckingDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.hargatruckingService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating harga trucking in controller:', error);

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
          message: 'Failed to Update harga trucking',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@HARGA-TRUCKING
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const findData = await this.hargatruckingService.findOne(id, trx);

      // Cek jika tarifdetail_id ada nilainya
      if (findData.data?.tarifdetail_id) {
        // Throw 500 dengan pesan khusus
        throw new BadRequestException(
          'Dilarang hapus, tarif detail id sudah ada',
        );
      }

      const result = await this.hargatruckingService.delete(
        id,
        trx,
        req.user?.user?.username,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting harga trucking in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete harga trucking');
    }
  }

  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportHargatruckingSchema))
    body: ReportHargatruckingDto,
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
        const result = await this.hargatruckingService.findAll(
          {
            search,
            filters: (filters ?? {}) as Record<string, string | number>,
            // limit 0 = tanpa paging, ambil semua baris yang lolos filter.
            pagination: { page: 1, limit: 0 },
            sort: {
              sortBy: sortBy || 'emkl_text',
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
          judullaporan: judullaporan ?? 'Laporan Harga Trucking',
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
    @Body(new ZodValidationPipe(ExportHargatruckingSchema))
    body: ExportHargatruckingDto,
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
      filename: `laporan_hargatrucking_${stamp}.xlsx`,
      countRows: () =>
        this.hargatruckingService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.hargatruckingService
          .buildExportQuery(queryParams, dbMssql)
          .stream(),
      sheet: this.hargatruckingService.exportSheet,
    });
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.hargatruckingService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_hargatrucking.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
