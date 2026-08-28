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
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { BookingOrderanHeaderService } from './booking-orderan-header.service';
import {
  CreateBookingOrderanHeaderDto,
  CreateBookingOrderanHeaderSchema,
} from './dto/create-booking-orderan-header.dto';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { BookingOrderanMuatanService } from './bookingorderanmuatan.service';
import { OrderanHeaderService } from '../orderan-header/orderan-header.service';

@Controller('bookingorderanheader')
export class BookingOrderanHeaderController {
  constructor(
    private readonly bookingOrderanHeaderService: BookingOrderanHeaderService,
    private readonly bookingOrderanMuatanService: BookingOrderanMuatanService,
    private readonly orderanHeaderService: OrderanHeaderService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@BOOKINGORDERANMUATAN
  async create(
    @Body(
      new InjectMethodPipe('create'),
      new ZodValidationPipe(CreateBookingOrderanHeaderSchema),
      KeyboardOnlyValidationPipe,
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.bookingOrderanHeaderService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating booking orderan header in controller',
        error,
        error.message,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create booking orderan header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@BOOKINGORDERANMUATAN
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: any) {
    const {
      search,
      page,
      limit,
      sortBy,
      sortDirection,
      isLookUp,
      jenisOrderan,
      ...filters
    } = query;
    let service: any;

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1,
      limit: limit === 0 || !limit ? undefined : limit,
    };

    const params = {
      search,
      filters,
      pagination,
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const getJenisOrderanMuatan = await trx('parameter')
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'MUATAN')
        .first();
      const getJenisOrderanBongkaran = await trx('parameter')
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'BONGKARAN')
        .first();
      const getJenisOrderanImport = await trx('parameter')
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'IMPORT')
        .first();
      const getJenisOrderanExport = await trx('parameter')
        .select('id')
        .where('grp', 'JENIS ORDERAN')
        .where('subgrp', 'EXPORT')
        .first();

      switch (jenisOrderan) {
        case getJenisOrderanMuatan?.id:
          service = this.bookingOrderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          // Default to MUATAN as per the original logic
          service = this.bookingOrderanMuatanService;
          break;
      }
      const result = await service.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all booking orderan header ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch booking orderan header',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@BOOKINGORDERANMUATAN
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      new ZodValidationPipe(CreateBookingOrderanHeaderSchema),
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.bookingOrderanHeaderService.update(
        id,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating booking orderan header in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update booking orderan header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@BOOKINGORDERANMUATAN
  async delete(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.bookingOrderanHeaderService.delete(
        id,
        trx,
        req.user?.user?.username,
        data,
      );

      if (result.status === 404) {
        throw new NotFoundException(result.message);
      }

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting data in controller: ', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  @UseGuards(AuthGuard)
  @Post('approvalBooking')
  async approval(@Body() body: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      let validator;
      body.modifiedby = req.user?.user?.username || 'unknown';

      if (body.mode === 'APPROVAL') {
        validator = await this.orderanHeaderService.approval(body, trx);
      } else {
        validator = await this.orderanHeaderService.nonApproval(body, trx);
      }
      console.log('validator', validator);

      await trx.commit();
      return validator;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error processing approval in booking orderan header controller:',
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to process approval in booking orderan header controller',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Get('/getbookingorderanmuatanById/:id')
  async findOneBookingOrderanMuatan(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.bookingOrderanMuatanService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne booking orderan muatan:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(
    @Body() body: { aksi: string; value: any; jenisOrderan: any },
    @Req() req,
  ) {
    let serviceCheckValidation: any;
    const { aksi, value, jenisOrderan } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    const getJenisOrderanMuatan = await trx('parameter')
      .select('id')
      .where('grp', 'JENIS ORDERAN')
      .where('subgrp', 'MUATAN')
      .first();
    const getJenisOrderanBongkaran = await trx('parameter')
      .select('id')
      .where('grp', 'JENIS ORDERAN')
      .where('subgrp', 'BONGKARAN')
      .first();
    const getJenisOrderanImport = await trx('parameter')
      .select('id')
      .where('grp', 'JENIS ORDERAN')
      .where('subgrp', 'IMPORT')
      .first();
    const getJenisOrderanExport = await trx('parameter')
      .select('id')
      .where('grp', 'JENIS ORDERAN')
      .where('subgrp', 'EXPORT')
      .first();

    switch (jenisOrderan) {
      case getJenisOrderanMuatan?.id:
        serviceCheckValidation = this.bookingOrderanMuatanService;
        break;
      // case 'IMPORT':
      //   service = this.hitungmodalimportService;
      //   break;
      // case 'EXPORT':
      //   service = this.hitungmodalexportService;
      //   break;
      default:
        // Default to MUATAN as per the original logic
        serviceCheckValidation = this.bookingOrderanMuatanService;
        break;
    }

    try {
      const forceEdit = await serviceCheckValidation.checkValidasi(
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
}
