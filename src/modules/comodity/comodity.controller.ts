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
  CreateComodityDto,
  CreateComoditySchema,
} from './dto/create-comodity.dto';
import {
  UpdateComodityDto,
  UpdateComoditySchema,
} from './dto/update-comodity.dto';
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
import { ComodityService } from './comodity.service';

@Controller('comodity')
export class ComodityController {
  constructor(private readonly comodityService: ComodityService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@COMODITY
  async create(
    @Body(
      new ZodValidationPipe(CreateComoditySchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateComodityDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.comodityService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        `Failed to create comodity: ${error?.message ?? String(error)}`,
      );
    }
  }

  @Get()
  //@COMODITY
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
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
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true',
    };
    const trx = await dbMssql.transaction();
    try {
      const result = await this.comodityService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error fetching all Comodity:', error);
      throw new InternalServerErrorException('Failed to fetch Comodity');
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@COMODITY
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateComoditySchema))
    data: UpdateComodityDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.comodityService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating Comodity in controller:', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update comodity');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@COMODITY
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.comodityService.delete(
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
      console.error('Error deleting comodity in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete comodity');
    }
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.comodityService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_Comodity.xlsx"',
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
      const data = await this.comodityService.findAllByIds(ids);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.comodityService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_Comodity.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Post('report-byselect')
  async findAllByIds(@Body() ids: { id: string }[]) {
    return this.comodityService.findAllByIds(ids);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.comodityService.getById(id, trx);
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
