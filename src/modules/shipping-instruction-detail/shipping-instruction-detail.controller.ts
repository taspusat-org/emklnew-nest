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
import { ShippingInstructionDetailService } from './shipping-instruction-detail.service';
import { CreateShippingInstructionDetailDto } from './dto/create-shipping-instruction-detail.dto';
import { UpdateShippingInstructionDetailDto } from './dto/update-shipping-instruction-detail.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('shippinginstructiondetail')
export class ShippingInstructionDetailController {
  constructor(
    private readonly shippingInstructionDetailService: ShippingInstructionDetailService,
  ) {}

  @Post()
  create(
    @Body()
    createShippingInstructionDetailDto: CreateShippingInstructionDetailDto,
  ) {
    // return this.shippingInstructionDetailService.create(createShippingInstructionDetailDto);
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
      const result = await this.shippingInstructionDetailService.findAll(
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
        'Error fetching data shipping instruction detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch shipping instruction detail in controller',
      );
    }
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    updateShippingInstructionDetailDto: UpdateShippingInstructionDetailDto,
  ) {
    return this.shippingInstructionDetailService.update(
      id,
      updateShippingInstructionDetailDto,
    );
  }
}
