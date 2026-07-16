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
import { PackinglistdetailrincianService } from './packinglistdetailrincian.service';
import { CreatePackinglistdetailrincianDto } from './dto/create-packinglistdetailrincian.dto';
import { UpdatePackinglistdetailrincianDto } from './dto/update-packinglistdetailrincian.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto } from 'src/common/interfaces/all.interface';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { InternalServerErrorException } from '@nestjs/common';

@Controller('packinglistdetailrincian')
export class PackinglistdetailrincianController {
  constructor(
    private readonly packinglistdetailrincianService: PackinglistdetailrincianService,
  ) {}

  @Post()
  create(
    @Body()
    createPackinglistdetailrincianDto: CreatePackinglistdetailrincianDto,
  ) {
    return this.packinglistdetailrincianService.create(
      createPackinglistdetailrincianDto,
    );
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
      const result = await this.packinglistdetailrincianService.findAll(
        params,
        trx,
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
        'Error fetching data packinglist detail rincian in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch packinglist detail rincian in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.packinglistdetailrincianService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    updatePackinglistdetailrincianDto: UpdatePackinglistdetailrincianDto,
  ) {
    return this.packinglistdetailrincianService.update(
      id,
      updatePackinglistdetailrincianDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.packinglistdetailrincianService.remove(id);
  }
}
