import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UsePipes,
  Query,
  InternalServerErrorException,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Put,
  Res,
} from '@nestjs/common';
import {
  CreateShippingInstructionSchema,
  UpdateShippingInstructionDto,
  UpdateShippingInstructionSchema,
} from './dto/create-shipping-instruction.dto';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { ShippingInstructionService } from './shipping-instruction.service';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import {
  ReportShippingInstructionDto,
  ReportShippingInstructionSchema,
} from './dto/report-shipping-instruction.dto';
import {
  ExportShippingInstructionDto,
  ExportShippingInstructionSchema,
} from './dto/export-shipping-instruction.dto';

@Controller('shippinginstruction')
export class ShippingInstructionController {
  constructor(
    private readonly shippingInstructionService: ShippingInstructionService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@SHIPPING-INSTRUCTION
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateShippingInstructionSchema),
      KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.shippingInstructionService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating shipping instruction in controller',
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create shipping instruction',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@SHIPPING-INSTRUCTION
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
      const result = await this.shippingInstructionService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all shipping instruction ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch shipping instruction',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@SHIPPING-INSTRUCTION
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdateShippingInstructionSchema),
    )
    data: UpdateShippingInstructionDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.shippingInstructionService.update(
        id,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating shipping instruction in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update shipping instruction',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@SHIPPING-INSTRUCTION
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.shippingInstructionService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error deleting shipping instruction in controller:',
        error,
      );
      throw new Error(
        `Error deleting shipping instruction in controller: ${error.message}`,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.shippingInstructionService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne shipping instruction:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.shippingInstructionService.checkValidasi(
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
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportShippingInstructionSchema))
    body: ReportShippingInstructionDto,
    @Req() req,
  ) {
    const { mrtName, id, judullaporan } = body;

    const username = req.user?.user?.username ?? 'unknown';
    const cabang = req.user?.user?.cabang ?? '';
    const pelabuhan = req.user?.user?.pelabuhan ?? '';

    return this.reportJobService.start({
      mrtName,
      loadData: async () => {
        const trx = await dbMssql.transaction();
        let result: any;
        try {
          result = await this.shippingInstructionService.findOne(
            String(id),
            trx,
          );
          await trx.commit();
        } catch (error) {
          await trx.rollback();
          throw error;
        }

        const header = Array.isArray(result?.data?.header)
          ? result.data.header
          : [];
        const detail = Array.isArray(result?.data?.detail)
          ? result.data.detail
          : [];

        // Satu baris per rincian, kolom detail induknya ikut diulang —
        // bentuk yang sama dengan yang dipakai template .mrt.
        const detailRows = detail.flatMap((item: any) =>
          (item.rincian || []).map((rincian: any) => ({
            ...item,
            rincian_id: rincian.id,
            rincian_comodity: rincian.comodity,
            rincian_keterangan: rincian.keterangan,
            rincian_nocontainer: rincian.nocontainer,
            rincian_noseal: rincian.noseal,
            rincian_orderan_muatan: rincian.orderanmuatan_nobukti,
            rincian_shipper_nama: rincian.shipper_nama,
            rincian_shippinginstructiondetail_id:
              rincian.shippinginstructiondetail_id,
            rincian_shippinginstructiondetail_nobukti:
              rincian.shippinginstructiondetail_nobukti,
          })),
        );

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const tglcetak =
          `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
          `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // Kolom tambahan di bawah dipakai header template .mrt.
        return {
          data: header.map((row: any) => ({
            ...row,
            judullaporan: judullaporan ?? 'PT. TRANSPORINDO AGUNG SEJAHTERA',
            usercetak: username,
            tglcetak,
            judul: 'EKSPEDISI MUATAN KAPAL LAUT',
            judul2: 'SHIPPING INSTRUCTION',
            cabang,
            pelabuhan,
          })),
          detail: detailRows,
        };
      },
    });
  }

  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportShippingInstructionSchema))
    body: ExportShippingInstructionDto,
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
      filename: `laporan_shippinginstruction_${stamp}.xlsx`,
      countRows: () =>
        this.shippingInstructionService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.shippingInstructionService
          .buildExportQuery(queryParams, dbMssql)
          .stream(),
      sheet: this.shippingInstructionService.exportSheet,
    });
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      const data = await this.findOne(id);

      if (!data) {
        throw new Error('Data is not found');
      }

      const tempFilePath = await this.shippingInstructionService.exportToExcel(
        data,
        id,
      );
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_shipping_instruction.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
