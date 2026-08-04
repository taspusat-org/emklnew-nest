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
import { AsuransiService } from './asuransi.service';
import {
  CreateAsuransiDto,
  CreateAsuransiSchema,
} from './dto/create-asuransi.dto';
import {
  UpdateAsuransiDto,
  UpdateAsuransiSchema,
} from './dto/update-asuransi.dto';
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
import { ReportAsuransiDto, ReportAsuransiSchema } from './dto/report-asuransi.dto';
import { ReportJobService } from 'src/common/report/report-job.service';


@Controller('asuransi')
export class AsuransiController {
  constructor(private readonly asuransiService: AsuransiService,    private readonly reportJobService: ReportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@ASURANSI
  async create(
    @Body(
      new ZodValidationPipe(CreateAsuransiSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateAsuransiDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.asuransiService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating asuransi in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create asuransi',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@ASURANSI
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
    const trx = await dbMssql.transaction();

    try {
      const result = await this.asuransiService.findAll(params, trx);
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
  //@ASURANSI
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAsuransiSchema))
    data: UpdateAsuransiDto,
    @Req() req,
  ) {
    console.log(
      `${new Date().toISOString()} [ctrl id=${id}] before dbMssql.transaction()`,
    );
    const trx = await dbMssql.transaction();
    console.log(
      `${new Date().toISOString()} [ctrl id=${id}] after  dbMssql.transaction()`,
    );
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.asuransiService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating asuransi in controller:', error);

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
          message: 'Failed to Update asuransi',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  @UseGuards(AuthGuard)
  @Delete(':id')
  //@ASURANSI
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.asuransiService.delete(
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
      console.error('Error deleting asuransi in controller:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete asuransi');
    }
  }

  /**
   * POST /groupbiayaextra/report
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
    @Body(new ZodValidationPipe(ReportAsuransiSchema))
    body: ReportAsuransiDto,
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
        const result = await this.asuransiService.findAll(
          {
            search,
            filters: (filters ?? {}) as Record<string, string | number>,
            // limit 0 = tanpa paging, ambil semua baris yang lolos filter.
            pagination: { page: 1, limit: 0 },
            sort: {
              sortBy: sortBy || 'keterangan',
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
          judullaporan: judullaporan ?? 'Laporan Asuransi',
          usercetak: username,
          tglcetak,
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        }));
      },
    });
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.asuransiService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_asuransi.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
