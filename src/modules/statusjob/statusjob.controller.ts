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
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { StatusjobService } from './statusjob.service';
import { CreateStatusjobDto } from './dto/create-statusjob.dto';
import { UpdateStatusjobDto } from './dto/update-statusjob.dto';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
@Controller('statusjob')
export class StatusjobController {
  constructor(private readonly statusjobService: StatusjobService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@STATUS-JOB
  async create(
    @Body(
      new InjectMethodPipe('create'),
      // new ZodValidationPipe(CreatePindahBukuSchema),
      // KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.statusjobService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating status job in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create status job',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@STATUS-JOB
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
      const result = await this.statusjobService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all status job in controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch status job');
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@STATUS-JOB
  async update(
    @Param('id') tglstatus: string,
    @Body(
      new InjectMethodPipe('update'),
      // new ZodValidationPipe(CreateBookingOrderanHeaderSchema),
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      console.log('con update', tglstatus);

      const result = await this.statusjobService.update(tglstatus, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while updating status job in controller:', error);

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update status job header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@STATUS-JOB
  async delete(@Param('id') tglstatus: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.statusjobService.delete(
        tglstatus,
        data,
        trx,
        // req.user?.user?.username,
      );

      if (result.status === 404) {
        throw new NotFoundException(result.message);
      }

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error delete data status job in controller: ', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to delete data status job',
      );
    }
  }

  // @UseGuards(AuthGuard)
  @Get('/detail/:tglstatus')
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findOne(@Param() tglstatus: string, @Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'id',
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
      const result = await this.statusjobService.findOne(
        trx,
        params,
        tglstatus,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne Status Job by tgl:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(
    @Body()
    body: { aksi: string; value: any; jenisOrderan: any; jenisStatusJob: any },
    @Req() req,
  ) {
    const { aksi, value, jenisOrderan, jenisStatusJob } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.statusjobService.checkValidasi(
        aksi,
        value,
        jenisOrderan,
        jenisStatusJob,
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
    @Param('id') tglstatus: string,
    @Query() query: any,
    @Res() res: Response,
  ) {
    try {
      const trx = await dbMssql.transaction();
      const {
        search,
        page,
        limit,
        sortBy,
        sortDirection,
        isLookUp,
        ...filterss
      } = query;

      const filters = {
        jenisOrderan: query.jenisOrderan || '',
        jenisStatusJob: query.jenisStatusJob || '',
      };

      const sortParams = {
        sortBy: query.sortBy || 'tglstatus',
        sortDirection: query.sortDirection || 'asc',
      };

      const pagination = {
        page: query.page || 0,
        limit: query.limit === 0 || !limit ? undefined : limit,
      };

      const params: FindAllParams = {
        search,
        filters,
        pagination,
        isLookUp: isLookUp === 'true',
        sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      };

      const { data } = await this.statusjobService.findOne(trx, params, {
        tglstatus,
      });
      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath = await this.statusjobService.exportToExcel(data, trx);

      // Stream file ke response
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_status_job.xlsx"',
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
      console.error('Error exporting to Excel:', error, error.message);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Failed to export file');
    }
  }
}
