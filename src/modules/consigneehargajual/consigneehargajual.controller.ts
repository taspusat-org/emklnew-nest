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
import { ConsigneehargajualService } from './consigneehargajual.service';
import { CreateConsigneehargajualDto } from './dto/create-consigneehargajual.dto';
import { UpdateConsigneehargajualDto } from './dto/update-consigneehargajual.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('consigneehargajual')
export class ConsigneehargajualController {
  constructor(
    private readonly consigneehargajualService: ConsigneehargajualService,
  ) {}

  @Post()
  create(@Body() createConsigneehargajualDto: CreateConsigneehargajualDto) {
    return this.consigneehargajualService.create(createConsigneehargajualDto);
  }

  @Get()
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const trx = await dbMssql.transaction();
    const sortParams = {
      sortBy: sortBy || 'container_nama',
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
      const result = await this.consigneehargajualService.findAll(params, trx);

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
    return this.consigneehargajualService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateConsigneehargajualDto: UpdateConsigneehargajualDto,
  ) {
    return this.consigneehargajualService.update(
      id,
      updateConsigneehargajualDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.consigneehargajualService.remove(id);
  }
}
