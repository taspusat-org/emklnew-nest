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
import { BiayaMuatanDetailService } from './biaya-muatan-detail.service';
import { CreateBiayaMuatanDetailDto } from './dto/create-biaya-muatan-detail.dto';
import { UpdateBiayaMuatanDetailDto } from './dto/update-biaya-muatan-detail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('biayamuatandetail')
export class BiayaMuatanDetailController {
  constructor(
    private readonly biayaMuatanDetailService: BiayaMuatanDetailService,
  ) {}

  @Post()
  create(@Body() createBiayaMuatanDetailDto: CreateBiayaMuatanDetailDto) {
    return this.biayaMuatanDetailService.create(createBiayaMuatanDetailDto);
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
      const result = await this.biayaMuatanDetailService.findAll(
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
        'Error fetching data biaya muatan detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch biaya muatan detail in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.biayaMuatanDetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBiayaMuatanDetailDto: UpdateBiayaMuatanDetailDto,
  ) {
    return this.biayaMuatanDetailService.update(
      id,
      updateBiayaMuatanDetailDto,
    );
  }
}
