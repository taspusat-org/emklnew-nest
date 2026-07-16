import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UsePipes,
  Query,
  HttpException,
  InternalServerErrorException,
  UseGuards,
  Req,
  NotFoundException,
  Put,
  Res,
} from '@nestjs/common';
import {
  CreateJenisOrderanDto,
  CreateJenisOrderanSchema,
} from './dto/create-jenisorderan.dto';
import {
  UpdateJenisOrderanDto,
  UpdateJenisOrderanSchema,
} from './dto/update-jenisorderan.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { Response } from 'express';
import * as fs from 'fs';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { JenisOrderanService } from './jenisorderan.service';

@Controller('JenisOrderan')
export class JenisOrderanController {
  constructor(private readonly JenisOrderanService: JenisOrderanService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@JenisOrderan
  async create(
    @Body(
      new ZodValidationPipe(CreateJenisOrderanSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateJenisOrderanDto,
    @Req() req,
  ) {
    // [DEBUG SEMENTARA] cetak payload yang dikirim frontend
    console.log(
      '[DEBUG create jenisorderan] payload =',
      JSON.stringify(data),
    );
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.JenisOrderanService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      // [DEBUG SEMENTARA] cetak error asli + kirim penyebabnya ke response
      console.error('[DEBUG create jenisorderan] ERROR ASLI:', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `Failed to create jenis orderan: ${error?.message ?? String(error)}`,
      );
    }
  }

  @Get()
  //@JenisOrderan
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
      const result = await this.JenisOrderanService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error fetching all JenisOrderan:', error);
      throw new InternalServerErrorException('Failed to fetch JenisOrderan');
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@JenisOrderan
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateJenisOrderanSchema))
    data: UpdateJenisOrderanDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.JenisOrderanService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating JenisOrderan in controller:', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update jenis orderan');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@JenisOrderan
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.JenisOrderanService.delete(
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
      console.error('Error deleting jenis orderan in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete jenis orderan');
    }
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.JenisOrderanService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_JenisOrderan.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Post('/export-byselect')
  async exportToExcelBySelect(
    @Body() ids: { id: string }[],
    @Res() res: Response,
  ) {
    try {
      const data = await this.JenisOrderanService.findAllByIds(ids);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.JenisOrderanService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_JenisOrderan.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
  @Post('report-byselect')
  async findAllByIds(@Body() ids: { id: string }[]) {
    return this.JenisOrderanService.findAllByIds(ids);
  }
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.JenisOrderanService.getById(id, trx);
      if (!result) {
        throw new Error('Data not found');
      }

      await trx.commit();
      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);

      await trx.rollback();
      throw new Error('Failed to fetch data by id');
    }
  }
}
