import { dbMssql } from 'src/common/utils/db';
import { BlDetailRincianService } from './bl-detail-rincian.service';
import { CreateBlDetailRincianDto } from './dto/create-bl-detail-rincian.dto';
import { UpdateBlDetailRincianDto } from './dto/update-bl-detail-rincian.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
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

@Controller('bldetailrincian')
export class BlDetailRincianController {
  constructor(
    private readonly blDetailRincianService: BlDetailRincianService,
  ) {}

  @Post()
  create(@Body() createBlDetailRincianDto: CreateBlDetailRincianDto) {
    return this.blDetailRincianService.create(createBlDetailRincianDto);
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
      const result = await this.blDetailRincianService.findAll(
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
        'Error fetching data bl detail rincian in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch bl detail rincian in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.blDetailRincianService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBlDetailRincianDto: UpdateBlDetailRincianDto,
  ) {
    return this.blDetailRincianService.update(id, updateBlDetailRincianDto);
  }
}
