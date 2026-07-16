import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { ShippingInstructionDetailRincianService } from './shipping-instruction-detail-rincian.service';
import { CreateShippingInstructionDetailRincianDto } from './dto/create-shipping-instruction-detail-rincian.dto';
import { UpdateShippingInstructionDetailRincianDto } from './dto/update-shipping-instruction-detail-rincian.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('shippinginstructiondetailrincian')
export class ShippingInstructionDetailRincianController {
  constructor(
    private readonly shippingInstructionDetailRincianService: ShippingInstructionDetailRincianService,
  ) {}

  @Post()
  create(
    @Body()
    createShippingInstructionDetailRincianDto: CreateShippingInstructionDetailRincianDto,
  ) {
    // return this.shippingInstructionDetailRincianService.create(createShippingInstructionDetailRincianDto);
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
      const result = await this.shippingInstructionDetailRincianService.findAll(
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
        'Error fetching data shipping instruction detail rincian in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch shipping instruction detail rincian in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.shippingInstructionDetailRincianService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    updateShippingInstructionDetailRincianDto: UpdateShippingInstructionDetailRincianDto,
  ) {
    return this.shippingInstructionDetailRincianService.update(
      id,
      updateShippingInstructionDetailRincianDto,
    );
  }
}
