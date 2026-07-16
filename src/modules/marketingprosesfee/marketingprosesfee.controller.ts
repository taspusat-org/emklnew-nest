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
import { MarketingprosesfeeService } from './marketingprosesfee.service';
import { CreateMarketingprosesfeeDto } from './dto/create-marketingprosesfee.dto';
import { UpdateMarketingprosesfeeDto } from './dto/update-marketingprosesfee.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('marketingprosesfee')
export class MarketingprosesfeeController {
  constructor(
    private readonly marketingprosesfeeService: MarketingprosesfeeService,
  ) {}

  @Post()
  create(@Body() createMarketingprosesfeeDto: CreateMarketingprosesfeeDto) {
    return this.marketingprosesfeeService.create(createMarketingprosesfeeDto);
  }

  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'marketing_nama',
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
      const result = await this.marketingprosesfeeService.findAll(
        id,
        trx,
        params,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data marketing proses fee in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch marketing ordean in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingprosesfeeService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMarketingprosesfeeDto: UpdateMarketingprosesfeeDto,
  ) {
    return this.marketingprosesfeeService.update(
      id,
      updateMarketingprosesfeeDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.marketingprosesfeeService.remove(id);
  }
}
