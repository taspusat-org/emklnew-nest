import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UsePipes,
  Query,
  InternalServerErrorException,
  Req,
  HttpException,
  HttpStatus,
  Put,
  NotFoundException,
  Res,
} from '@nestjs/common';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import {
  CreateJenisProsesFeeDto,
  CreateJenisProsesFeeSchema,
  UpdateJenisProsesFeeDto,
  UpdateJenisProsesFeeSchema,
} from './dto/create-jenisprosesfee.dto';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { JenisprosesfeeService } from './jenisprosesfee.service';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';

@Controller('jenisprosesfee')
export class JenisprosesfeeController {
  constructor(private readonly jenisprosesfeeService: JenisprosesfeeService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@JENIS-PROSES-FEE
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateJenisProsesFeeSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateJenisProsesFeeDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.jenisprosesfeeService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating Jenis Proses Fee in controller',
        error,
      );

      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create Jenis Proses Fee',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@JENIS-PROSES-FEE
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
      const result = await this.jenisprosesfeeService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error fetching all jenis biaya marketing:', error);
      throw new InternalServerErrorException(
        'Failed to fetch jenis biaya marketing',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@JENIS-PROSES-FEE
  async update(
    @Param('id') dataId: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(UpdateJenisProsesFeeSchema),
    )
    data: UpdateJenisProsesFeeDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();

    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.jenisprosesfeeService.update(
        +dataId,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating Jenis Proses Fee in controller:',
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update Jenis Proses Fee',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@JENIS-PROSES-FEE
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.jenisprosesfeeService.delete(
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
      console.error(
        'Error deleting data jenis proses fee in controller: ',
        error,
      );

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to delete data jenis proses fee in controller',
      );
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.jenisprosesfeeService.checkValidasi(
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

      const tempFilePath = await this.jenisprosesfeeService.exportToExcel(data);
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_jenisprosesfee.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jenisprosesfeeService.findOne(id);
  }
}
