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
  NotFoundException,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import { OffdaysService } from './offdays.service';
import { CreateOffdayDto, CreateOffdaySchema } from './dto/create-offday.dto';
import { UpdateOffdayDto, UpdateOffdaySchema } from './dto/update-offday.dto';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';
import { Response } from 'express';
import * as fs from 'fs';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { Throttle } from '@nestjs/throttler';

@Controller('offdays')
export class OffdaysController {
  constructor(private readonly offdaysService: OffdaysService) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateOffdaySchema))
    data: CreateOffdayDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.offdaysService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      throw new Error(`Error creating parameter: ${error.message}`);
    }
  }

  @Get()
  @Throttle({
    default: {
      ttl: 60000,
      limit: 10,
    },
  })
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Req() req, @Query() query: FindAllDto) {
    const trx = await dbMssql.transaction();
    try {
      const {
        search,
        page,
        limit,
        sortBy,
        sortDirection,
        isLookUp,
        ...filters
      }: { [key: string]: any } = query;
      filters.cabang_id = 26;
      const sortParams = {
        sortBy: sortBy || 'keterangan',
        sortDirection: sortDirection || 'asc',
      };

      const pagination = {
        page: page || 1,
        limit: limit === 0 || !limit ? undefined : limit,
      };

      const params: FindAllParams = {
        search,
        filters,
        isLookUp: isLookUp === 'true',

        pagination,
        sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      };
      const result = await this.offdaysService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      console.log(error, 'error');
      console.error('Error fetching data:', error);
      trx.rollback();
      throw new Error('Failed to fetch data');
    }
  }
  @Get('tes-money')
  async findAllTes() {
    return this.offdaysService.findAllTes();
  }
  @Get('trado')
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllTrado(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'keterangan',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1,
      limit: limit === 0 || !limit ? undefined : limit,
    };

    const params: FindAllParams = {
      search,
      filters,
      isLookUp: isLookUp === 'true',

      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };
    return this.offdaysService.findAllTrado(params);
  }

  @Get('/export')
  @UseGuards(AuthGuard)
  async exportToExcel(@Req() req, @Query() params: any, @Res() res: Response) {
    try {
      // Mengambil data dari findAll dengan params
      const { data } = await this.findAll(req, params);
      // Cek apakah data ada dan merupakan array
      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      // Memanggil service untuk menghasilkan file Excel
      const tempFilePath = await this.offdaysService.exportToExcel(data);

      // Buat header untuk response download
      const fileStream = fs.createReadStream(tempFilePath);

      // Set response headers for Excel file download
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_harilibur.xlsx"',
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
      const result = await this.offdaysService.getById(id, trx);
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

  @UseGuards(AuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOffdaySchema)) data: UpdateOffdayDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.offdaysService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating parameter in controller:', error);
      throw new Error('Failed to update parameter');
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.offdaysService.delete(id, trx);

      if (result.status === 404) {
        throw new NotFoundException(result.message);
      }

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting data in controller:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete data');
    }
  }
}
