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
import { BlDetailService } from './bl-detail.service';
import { CreateBlDetailDto } from './dto/create-bl-detail.dto';
import { UpdateBlDetailDto } from './dto/update-bl-detail.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('bldetail')
export class BlDetailController {
  constructor(private readonly blDetailService: BlDetailService) {}

  @Post()
  create(@Body() createBlDetailDto: CreateBlDetailDto) {
    return this.blDetailService.create(createBlDetailDto);
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
      const result = await this.blDetailService.findAll(id, trx, params);
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
        'Error fetching data bl detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch bl detail in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.blDetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBlDetailDto: UpdateBlDetailDto,
  ) {
    return this.blDetailService.update(id, updateBlDetailDto);
  }
}
