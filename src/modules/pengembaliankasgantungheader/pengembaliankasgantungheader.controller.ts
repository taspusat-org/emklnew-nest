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
  UseGuards,
  Req,
  Put,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { PengembaliankasgantungheaderService } from './pengembaliankasgantungheader.service';
import { CreatePengembaliankasgantungheaderDto } from './dto/create-pengembaliankasgantungheader.dto';
import { UpdatePengembaliankasgantungheaderDto } from './dto/update-pengembaliankasgantungheader.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import * as fs from 'fs';
import { Response } from 'express';

@Controller('pengembaliankasgantungheader')
export class PengembaliankasgantungheaderController {
  constructor(
    private readonly pengembaliankasgantungheaderService: PengembaliankasgantungheaderService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PENGEMBALIAN-KAS-GANTUNG
  async create(
    @Body()
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pengembaliankasgantungheaderService.create(
        data,
        trx,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      throw new Error(`Error: ${error.message}`);
    }
  }
  @UseGuards(AuthGuard)
  @Get()
  //@PENGEMBALIAN-KAS-GANTUNG
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
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true',
    };
    const trx = await dbMssql.transaction();

    try {
      const result = await this.pengembaliankasgantungheaderService.findAll(
        params,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @UseGuards(AuthGuard)
  @Put(':id')
  //@PENGEMBALIAN-KAS-GANTUNG
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pengembaliankasgantungheaderService.update(
        id,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating menu in controller:', error);
      throw new Error('Failed to update menu');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@PENGEMBALIAN-KAS-GANTUNG
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.pengembaliankasgantungheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting pengembaliankasgantungheader:', error);
      throw new Error(
        `Error deleting pengembaliankasgantungheader: ${error.message}`,
      );
    }
  }
  @Get('report-all')
  //@PENGEMBALIAN-KAS-GANTUNG
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllReport(@Query() query: FindAllDto) {
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
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true',
    };
    const trx = await dbMssql.transaction();

    try {
      const result =
        await this.pengembaliankasgantungheaderService.findAllReport(
          params,
          trx,
        );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  //@KAS-GANTUNG
  async findOne(@Param('id') id: string, @Query() query: FindAllDto) {
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
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };
    const trx = await dbMssql.transaction();

    try {
      const result = await this.pengembaliankasgantungheaderService.findOne(
        params,
        id,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Get('/export/:id')
  async exportToExcel(
    @Param('id') id: string,
    @Query() query: any,
    @Res() res: Response,
  ) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.pengembaliankasgantungheaderService.findOne(
        query,
        id,
        trx,
      );

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath =
        await this.pengembaliankasgantungheaderService.exportToExcel(data, trx);

      // Stream file ke response
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_pengembaliankasgantung.xlsx"',
      );

      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);

      // Optional: hapus file temp setelah selesai streaming
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
}
