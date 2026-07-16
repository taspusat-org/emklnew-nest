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
import { MarketingmanagerService } from './marketingmanager.service';
import { CreateMarketingmanagerDto } from './dto/create-marketingmanager.dto';
import { UpdateMarketingmanagerDto } from './dto/update-marketingmanager.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('marketingmanager')
export class MarketingmanagerController {
  constructor(
    private readonly marketingmanagerService: MarketingmanagerService,
  ) {}

  @Post()
  create(@Body() createMarketingmanagerDto: CreateMarketingmanagerDto) {
    return this.marketingmanagerService.create(createMarketingmanagerDto);
  }

  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'managermarketing',
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
      const result = await this.marketingmanagerService.findAll(
        id,
        trx,
        params,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data marketing manager in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch marketing manager in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingmanagerService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMarketingmanagerDto: UpdateMarketingmanagerDto,
  ) {
    return this.marketingmanagerService.update(id, updateMarketingmanagerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.marketingmanagerService.remove(id);
  }
}
