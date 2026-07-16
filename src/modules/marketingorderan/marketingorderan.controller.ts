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
import { MarketingorderanService } from './marketingorderan.service';
import { CreateMarketingorderanDto } from './dto/create-marketingorderan.dto';
import { UpdateMarketingorderanDto } from './dto/update-marketingorderan.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('marketingorderan')
export class MarketingorderanController {
  constructor(
    private readonly marketingorderanService: MarketingorderanService,
  ) {}

  @Post()
  create(@Body() createMarketingorderanDto: CreateMarketingorderanDto) {
    return this.marketingorderanService.create(createMarketingorderanDto);
  }

  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
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
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.marketingorderanService.findAll(
        id,
        trx,
        params,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data marketing orderan in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch marketing orderan in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingorderanService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMarketingorderanDto: UpdateMarketingorderanDto,
  ) {
    return this.marketingorderanService.update(id, updateMarketingorderanDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.marketingorderanService.remove(id);
  }
}
