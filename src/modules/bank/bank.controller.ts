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
import { BankService } from './bank.service';
import { CreateBankDto, CreateBankSchema } from './dto/create-bank.dto';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateBankDto, UpdateBankSchema } from './dto/update-bank.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { Response } from 'express';
import * as fs from 'fs';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { isRecordExist } from 'src/utils/utils.service';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import { ExportBankDto, ExportBankSchema } from './dto/export-bank.dto';
import { ReportBankDto, ReportBankSchema } from './dto/report-bank.dto';

@Controller('bank')
export class BankController {
  constructor(
    private readonly bankService: BankService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@BANK
  async create(
    @Body(new ZodValidationPipe(CreateBankSchema), KeyboardOnlyValidationPipe)
    data: CreateBankDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.bankService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating bank in controller', error);

      // Ensure any other errors get caught and returned
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create bank',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@BANK
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
    // Endpoint baca: TANPA transaksi, lihat alatbayar.controller.ts.
    // return this.bankService.findAll(params, dbMssql);

    const trx = await dbMssql.transaction();
    try {
      const result = await this.bankService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error;
    }
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  //@BANK
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBankSchema))
    data: UpdateBankDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.bankService.update(id, data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating Bank in controller:', error);
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

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

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@BANK
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.bankService.delete(
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
      console.error('Error deleting bank in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete bank');
    }
  }

  @UseGuards(AuthGuard)
    @Post('report')
    async report(
      @Body(new ZodValidationPipe(ReportBankSchema))
      body: ReportBankDto,
      @Req() req,
    ) {
      const { mrtName, search, filters, sortBy, sortDirection, judullaporan } =
        body;
  
      const username = req.user?.user?.username ?? 'unknown';
  
      return this.reportJobService.start({
        mrtName,
        loadData: async () => {
          const result = await this.bankService.findAll(
            {
              search,
              filters: (filters ?? {}) as Record<string, string | number>,
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
  
          return rows.map((row: any) => ({
            ...row,
            judullaporan: judullaporan ?? 'Laporan Bank',
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
      @Body(new ZodValidationPipe(ExportBankSchema))
      body: ExportBankDto,
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
        filename: `laporan_bank_${stamp}.xlsx`,
        countRows: () =>
          this.bankService.countExportRows(queryParams, dbMssql),
        streamRows: () =>
          this.bankService.buildExportQuery(queryParams, dbMssql).stream(),
        sheet: this.bankService.exportSheet,
      });
    }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.bankService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_bank.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
