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
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CreatePengeluaranEmklDto,
  CreatePengeluaranEmklSchema,
  UpdatePengeluaranEmklDto,
  UpdatePengeluaranEmklSchema,
} from './dto/create-pengeluaran-emkl.dto';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { PengeluaranEmklService } from './pengeluaran-emkl.service';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';

@Controller('pengeluaranemkl')
export class PengeluaranEmklController {
  constructor(
    private readonly pengeluaranEmklService: PengeluaranEmklService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PENGELUARAN-EMKL
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreatePengeluaranEmklSchema),
    )
    data: CreatePengeluaranEmklDto,
    @Req() req,
  ) {
    console.log('masuk sini');

    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.pengeluaranEmklService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating pengeluaran emkl in controller',
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create pengeluaran emkl',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@PENGELUARAN-EMKL
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
      const result = await this.pengeluaranEmklService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all pengeluaran emkl ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch pengeluaran emkl',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@PENGELUARAN-EMKL
  async update(
    @Param('id') dataId: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdatePengeluaranEmklSchema),
    )
    data: UpdatePengeluaranEmklDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pengeluaranEmklService.update(
        +dataId,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating pengeluaran emkl in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update pengeluaran emkl',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@PENGELUARAN-EMKL
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.pengeluaranEmklService.delete(
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
      const forceEdit = await this.pengeluaranEmklService.checkValidasi(
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

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined');
      }

      const tempFilePath =
        await this.pengeluaranEmklService.exportToExcel(data);
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_pengeluaran_emkl.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
