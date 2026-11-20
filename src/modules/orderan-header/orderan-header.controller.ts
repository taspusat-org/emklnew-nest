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
import { OrderanHeaderService } from './orderan-header.service';
import { CreateOrderanHeaderDto } from './dto/create-orderan-header.dto';
import { UpdateOrderanHeaderDto } from './dto/update-orderan-header.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { FindAllSchema } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { OrderanMuatanService } from './orderan-muatan.service';
import { AuthGuard } from '../auth/auth.guard';
import { InjectMethodPipe } from 'src/common/pipes/inject-method.pipe';

@Controller('orderanheader')
export class OrderanHeaderController {
  constructor(
    private readonly orderanHeaderService: OrderanHeaderService,
    private readonly orderanMuatanService: OrderanMuatanService,
  ) {}

  @Post()
  //@ORDERANMUATAN
  create(@Body() createOrderanHeaderDto: CreateOrderanHeaderDto) {
    return this.orderanHeaderService.create(createOrderanHeaderDto);
  }

  @Get()
  //@ORDERANMUATAN
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
      notIn,
      exactMatch,
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
      exactMatch,
    };

    const trx = await dbMssql.transaction();
    try {
      const getJenisOrderanMuatan = await trx('jenisorder')
        .select('id')
        .where('nama', 'MUATAN')
        .first();
      const getJenisOrderanBongkaran = await trx('jenisorder')
        .select('id')
        .where('nama', 'BONGKARAN')
        .first();
      const getJenisOrderanImport = await trx('jenisorder')
        .select('id')
        .where('nama', 'IMPORT')
        .first();
      const getJenisOrderanExport = await trx('jenisorder')
        .select('id')
        .where('nama', 'EKSPORT')
        .first();
      console.log(
        'getJenisOrderanMuatan',
        getJenisOrderanMuatan,
        getJenisOrderanMuatan.id,
      );

      switch (jenisOrderan) {
        case getJenisOrderanMuatan?.id:
          service = this.orderanMuatanService;
          break;
        // case 'IMPORT':
        //   service = this.hitungmodalimportService;
        //   break;
        // case 'EXPORT':
        //   service = this.hitungmodalexportService;
        //   break;
        default:
          service = this.orderanMuatanService;
          break;
      }
      const result = await service.findAll(params, trx, notIn);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all orderan header ini controller:',
        error,
        error.message,
      );
      throw new InternalServerErrorException('Failed to fetch orderan header');
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@ORDERANMUATAN
  async update(
    @Param('id') id: string,
    @Body(
      new InjectMethodPipe('update'),
      // new ZodValidationPipe(CreateOrderanHeaderSchema),
    )
    data: any,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.orderanHeaderService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while updating orderan header in controller:',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update orderan header',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@ORDERANMUATAN
  async delete(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.orderanHeaderService.delete(
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
      console.error('Error deleting orderan header in controller: ', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to deleting orderan header in controller',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
        serviceCheckValidation = this.orderanMuatanService;
        break;
      // case 'IMPORT':
      //   service = this.hitungmodalimportService;
      //   break;
      // case 'EXPORT':
      //   service = this.hitungmodalexportService;
      //   break;
      default:
        // Default to MUATAN as per the original logic
        serviceCheckValidation = this.orderanMuatanService;
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

  @Get('processshippingmuatan/:schedule_id')
  @UseGuards(AuthGuard)
  async prosesShippingOrderanMuatan(@Param('schedule_id') schedule_id) {
    console.log('schedule_id', schedule_id);
    const trx = await dbMssql.transaction();
    try {
      const forceEdit = await this.orderanMuatanService.processShipping(
        schedule_id,
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
