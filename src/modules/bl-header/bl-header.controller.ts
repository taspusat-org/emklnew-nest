import {
  Get,
  Put,
  Req,
  Post,
  Body,
  Query,
  Param,
  Delete,
  UsePipes,
  UseGuards,
  HttpStatus,
  Controller,
  HttpException,
  InternalServerErrorException,
  Res,
} from '@nestjs/common';
import * as fs from 'fs';
import { Response } from 'express';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { BlHeaderService } from './bl-header.service';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  CreateBlSchema,
  UpdateBlDto,
  UpdateBlSchema,
} from './dto/create-bl-header.dto';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';

@Controller('blheader')
export class BlHeaderController {
  constructor(private readonly blHeaderService: BlHeaderService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@BL-HEADER
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateBlSchema),
      KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.blHeaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating bl header in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create bl header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@BL-HEADER
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
      const result = await this.blHeaderService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all bl header ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch bl header');
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@BL-HEADER
  async update(
    @Param('id') id: string,
    @Body(new InjectMethodPipe('update'), new ZodValidationPipe(UpdateBlSchema))
    data: UpdateBlDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.blHeaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while updating bl header in controller:', error);

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update bl header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@BL-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.blHeaderService.delete(id, trx, modifiedby);

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting bl header in controller:', error);
      throw new Error(
        `Error deleting bl header in controller: ${error.message}`,
      );
    }
  }

  @Get('processbl/:schedule_id')
  @UseGuards(AuthGuard)
  async prosesBl(@Param('schedule_id') schedule_id) {
    const trx = await dbMssql.transaction();
    try {
      const proccesBl = await this.blHeaderService.processBl(schedule_id, trx);
      trx.commit();
      return proccesBl;
    } catch (error) {
      trx.rollback();
      console.error('Error to proccess bl:', error);
      throw new InternalServerErrorException('Failed to proccess bl');
    }
  }

  @UseGuards(AuthGuard)
  @Get('processblrincianbiaya')
  async prosesBlRincianBiaya() {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.blHeaderService.processBlRincianBiaya(trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error to proccess bl rincian biaya:', error);
      throw new InternalServerErrorException(
        'Failed to proccess bl rincian biaya',
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
      const forceEdit = await this.blHeaderService.checkValidasi(
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
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      const data = await this.findOne(id);

      if (!data.data && data?.data.length === 0) {
        throw new Error('Data is not found');
      }

      const tempFilePath = await this.blHeaderService.exportToExcel(data, id);
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

  @UseGuards(AuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.blHeaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne bl header:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
