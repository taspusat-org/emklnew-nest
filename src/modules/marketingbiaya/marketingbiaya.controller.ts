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
import { MarketingbiayaService } from './marketingbiaya.service';
import { CreateMarketingbiayaDto } from './dto/create-marketingbiaya.dto';
import { UpdateMarketingbiayaDto } from './dto/update-marketingbiaya.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('marketingbiaya')
export class MarketingbiayaController {
  constructor(private readonly marketingbiayaService: MarketingbiayaService) {}

  @Post()
  create(@Body() createMarketingbiayaDto: CreateMarketingbiayaDto) {
    return this.marketingbiayaService.create(createMarketingbiayaDto);
  }

  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nominal',
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
      const result = await this.marketingbiayaService.findAll(id, trx, params);

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data marketing biaya in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch marketing biaya in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingbiayaService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMarketingbiayaDto: UpdateMarketingbiayaDto,
  ) {
    return this.marketingbiayaService.update(id, updateMarketingbiayaDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.marketingbiayaService.remove(id);
  }
}
