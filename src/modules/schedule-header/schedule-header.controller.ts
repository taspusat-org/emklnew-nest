import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  UsePipes,
  Query,
  Put,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import {
  CreateScheduleDto,
  CreateScheduleSchema,
  UpdateScheduleDto,
  UpdateScheduleSchema,
} from './dto/create-schedule-header.dto';
import { dbMssql } from 'src/common/utils/db';
import * as fs from 'fs';
import { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ScheduleHeaderService } from './schedule-header.service';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';

@Controller('schedule-header')
export class ScheduleHeaderController {
  constructor(private readonly scheduleHeaderService: ScheduleHeaderService) {}

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
      console.error('Error while creating type akuntansi in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create type akuntansi',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@SCHEDULE-HEADER
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
    @Param('id')
    id: string,
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
      //
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
          message: 'Failed to update schedule header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@SCHEDULE-HEADER
  async delete(
    @Param('id')
    id: string,
    @Req() req,
  ) {
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
      throw new Error(
        `Error deleting schedule header in controller: ${error.message}`,
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

  @Get('/export/:id')
  async exportToExcel(
    @Param('id') id: string,
    @Query() params: any,
    @Res() res: Response,
  ) {
    try {
      const data = await this.findOne(id);

      if (!data) {
        throw new Error('Data is not found');
      }

      const tempFilePath = await this.scheduleHeaderService.exportToExcel(
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
        'attachment; filename="laporan_schedule.xlsx"',
      );

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
      const result = await this.scheduleHeaderService.getById(id, trx);

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
