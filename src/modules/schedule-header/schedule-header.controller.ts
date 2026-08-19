import {
  Res,
  Get,
  Put,
  Req,
  Post,
  Body,
  Param,
  Query,
  Delete,
  UsePipes,
  UseGuards,
  HttpStatus,
  Controller,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { ScheduleHeaderService } from './schedule-header.service';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import {
  CreateScheduleDto,
  CreateScheduleSchema,
  UpdateScheduleDto,
  UpdateScheduleSchema,
} from './dto/create-schedule-header.dto';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportScheduleHeaderDto,
  ReportScheduleHeaderSchema,
} from './dto/report-schedule-header.dto';
import {
  ExportScheduleHeaderDto,
  ExportScheduleHeaderSchema,
} from './dto/export-schedule-header.dto';

@Controller('schedule-header')
export class ScheduleHeaderController {
  constructor(
    private readonly scheduleHeaderService: ScheduleHeaderService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@SCHEDULE-HEADER
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateScheduleSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateScheduleDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.scheduleHeaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating schedule header in controller',
        error,
      );

      // PENTING: jangan bungkus HttpException dengan Error baru — pesan
      // validasi dari service akan hilang dan frontend hanya melihat 500.
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to create schedule header',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@SCHEDULE-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: any) {
    // isreload dibuang di sini: sudah tak dipakai, tapi frontend masih
    // mengirimnya dan tak boleh ikut jadi filter kolom.
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
      const result = await this.scheduleHeaderService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll Controller Schedule Header:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@SCHEDULE-HEADER
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdateScheduleSchema),
      KeyboardOnlyValidationPipe,
    )
    data: UpdateScheduleDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.scheduleHeaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating schedule header in controller:',
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to update schedule header',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@SCHEDULE-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.scheduleHeaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting schedule header in controller:', error);
      throw error;
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.scheduleHeaderService.checkValidasi(
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
   * POST /schedule-header/report
   *
   * Cetak bukti schedule di background. Request langsung balas { jobId };
   * progres render dikirim lewat socket namespace `/report` (event
   * `report:progress`, room = jobId), dan PDF-nya diambil di
   * GET /report/download/:jobId.
   *
   * LaporanSchedule.mrt adalah bukti PER TRANSAKSI, jadi yang dikirim frontend
   * hanya id baris yang dicentang. Datanya dua tabel — `data` (header) dan
   * `details` (rincian) — sesuai datasource template.
   */
  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportScheduleHeaderSchema))
    body: ReportScheduleHeaderDto,
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
        this.scheduleHeaderService.loadReportData(
          id,
          { username, judullaporan },
          dbMssql,
        ),
    });
  }

  /**
   * POST /schedule-header/export
   *
   * Export Excel SATU bukti schedule beserta rinciannya di background —
   * cakupannya sama dengan cetak bukti, bukan daftar seluruh baris grid.
   * Request langsung balas { jobId }; progresnya dikirim lewat socket namespace
   * `/report` (kanal yang sama dengan cetak laporan), dan file-nya diambil di
   * GET /report/download/:jobId.
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportScheduleHeaderSchema))
    body: ExportScheduleHeaderDto,
  ) {
    const id = String(body.id);
    const header = await this.scheduleHeaderService.loadExportBuktiHeader(
      id,
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
      filename: `schedule_${nobukti}_${stamp}.xlsx`,
      countRows: () =>
        this.scheduleHeaderService.countExportBuktiRows(id, dbMssql),
      streamRows: () =>
        this.scheduleHeaderService.buildExportBuktiQuery(id, dbMssql).stream(),
      sheet: this.scheduleHeaderService.buildExportBuktiSheet(header),
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      const trx = await dbMssql.transaction();
      const { data } = await this.scheduleHeaderService.findOne(id, trx);

      if (!Array.isArray(data) || data.length === 0) {
        await trx.rollback();
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.scheduleHeaderService.exportToExcel(
        data,
        trx,
      );
      await trx.commit();

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_schedule.xlsx"',
      );

      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);

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

  @UseGuards(AuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.scheduleHeaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
