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
import { BlDetailRincianBiayaService } from './bl-detail-rincian-biaya.service';
import { CreateBlDetailRincianBiayaDto } from './dto/create-bl-detail-rincian-biaya.dto';
import { UpdateBlDetailRincianBiayaDto } from './dto/update-bl-detail-rincian-biaya.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('bldetailrincianbiaya')
export class BlDetailRincianBiayaController {
  constructor(
    private readonly blDetailRincianBiayaService: BlDetailRincianBiayaService,
  ) {}

  @Post()
  create(@Body() createBlDetailRincianBiayaDto: CreateBlDetailRincianBiayaDto) {
    return this.blDetailRincianBiayaService.create(
      createBlDetailRincianBiayaDto,
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
      const result = await this.blDetailRincianBiayaService.findAll(
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
        'Error fetching data bl detail rincian biaya in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch bl detail rincian biaya in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.blDetailRincianBiayaService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBlDetailRincianBiayaDto: UpdateBlDetailRincianBiayaDto,
  ) {
    return this.blDetailRincianBiayaService.update(
      id,
      updateBlDetailRincianBiayaDto,
    );
  }
}
