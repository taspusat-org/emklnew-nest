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
import { ConsigneebiayaService } from './consigneebiaya.service';
import { CreateConsigneebiayaDto } from './dto/create-consigneebiaya.dto';
import { UpdateConsigneebiayaDto } from './dto/update-consigneebiaya.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('consigneebiaya')
export class ConsigneebiayaController {
  constructor(private readonly consigneebiayaService: ConsigneebiayaService) {}

  @Post()
  create(@Body() createConsigneebiayaDto: CreateConsigneebiayaDto) {
    return this.consigneebiayaService.create(createConsigneebiayaDto);
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
      const result = await this.consigneebiayaService.findAll(params, trx);

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
    return this.consigneebiayaService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateConsigneebiayaDto: UpdateConsigneebiayaDto,
  ) {
    return this.consigneebiayaService.update(id, updateConsigneebiayaDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.consigneebiayaService.remove(id);
  }
}
