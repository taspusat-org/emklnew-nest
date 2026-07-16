import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { PackinglistdetailService } from './packinglistdetail.service';
import { CreatePackinglistdetailDto } from './dto/create-packinglistdetail.dto';
import { UpdatePackinglistdetailDto } from './dto/update-packinglistdetail.dto';
import { FindAllDto } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { InternalServerErrorException } from '@nestjs/common';

@Controller('packinglistdetail')
export class PackinglistdetailController {
  constructor(
    private readonly packinglistdetailService: PackinglistdetailService,
  ) {}

  @Post()
  create(@Body() createPackinglistdetailDto: CreatePackinglistdetailDto) {
    return this.packinglistdetailService.create(createPackinglistdetailDto);
  }

  @Get()
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const trx = await dbMssql.transaction();
    const sortParams = {
      sortBy: sortBy || 'nobukti',
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
    try {
      const result = await this.packinglistdetailService.findAll(params, trx);

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
        'Error fetching data packinglist detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch packinglist detail in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packinglistdetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePackinglistdetailDto: UpdatePackinglistdetailDto,
  ) {
    return this.packinglistdetailService.update(
      id,
      updatePackinglistdetailDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.packinglistdetailService.remove(id);
  }
}
