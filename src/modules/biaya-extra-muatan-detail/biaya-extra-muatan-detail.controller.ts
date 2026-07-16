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
import { BiayaExtraMuatanDetailService } from './biaya-extra-muatan-detail.service';
import { CreateBiayaExtraMuatanDetailDto } from './dto/create-biaya-extra-muatan-detail.dto';
import { UpdateBiayaExtraMuatanDetailDto } from './dto/update-biaya-extra-muatan-detail.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('biayaextramuatandetail')
export class BiayaExtraMuatanDetailController {
  constructor(
    private readonly biayaExtraMuatanDetailService: BiayaExtraMuatanDetailService,
  ) {}

  @Post()
  create(
    @Body() createBiayaExtraMuatanDetailDto: CreateBiayaExtraMuatanDetailDto,
  ) {
    return this.biayaExtraMuatanDetailService.create(
      createBiayaExtraMuatanDetailDto,
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
      const result = await this.biayaExtraMuatanDetailService.findAll(
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
        'Error fetching data biaya extra muatan detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch biaya extra muatan detail in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.biayaExtraMuatanDetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBiayaExtraMuatanDetailDto: UpdateBiayaExtraMuatanDetailDto,
  ) {
    return this.biayaExtraMuatanDetailService.update(
      id,
      updateBiayaExtraMuatanDetailDto,
    );
  }
}
