import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  InternalServerErrorException,
  Query,
} from '@nestjs/common';
import { EstimasiBiayaDetailInvoiceService } from './estimasi-biaya-detail-invoice.service';
import { CreateEstimasiBiayaDetailInvoiceDto } from './dto/create-estimasi-biaya-detail-invoice.dto';
import { UpdateEstimasiBiayaDetailInvoiceDto } from './dto/update-estimasi-biaya-detail-invoice.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('estimasibiayadetailinvoice')
export class EstimasiBiayaDetailInvoiceController {
  constructor(
    private readonly estimasiBiayaDetailInvoiceService: EstimasiBiayaDetailInvoiceService,
  ) {}

  @Post()
  create(
    @Body()
    createEstimasiBiayaDetailInvoiceDto: CreateEstimasiBiayaDetailInvoiceDto,
  ) {
    return this.estimasiBiayaDetailInvoiceService.create(
      createEstimasiBiayaDetailInvoiceDto,
    );
  }

  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
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
      const result = await this.estimasiBiayaDetailInvoiceService.findAll(
        id,
        trx,
        params,
      );
      if (result.data.length === 0) {
        await trx.commit();

        return {
          status: false,
          message: 'No data found',
          data: [],
        };
      }
      await trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data estimasi biaya detail invoice in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch estimasi biaya detail invoice in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.estimasiBiayaDetailInvoiceService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    updateEstimasiBiayaDetailInvoiceDto: UpdateEstimasiBiayaDetailInvoiceDto,
  ) {
    return this.estimasiBiayaDetailInvoiceService.update(
      id,
      updateEstimasiBiayaDetailInvoiceDto,
    );
  }
}
