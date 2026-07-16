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
import { ConsigneedetailService } from './consigneedetail.service';
import { CreateConsigneedetailDto } from './dto/create-consigneedetail.dto';
import { UpdateConsigneedetailDto } from './dto/update-consigneedetail.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('consigneedetail')
export class ConsigneedetailController {
  constructor(
    private readonly consigneedetailService: ConsigneedetailService,
  ) {}

  @Post()
  create(@Body() createConsigneedetailDto: CreateConsigneedetailDto) {
    return this.consigneedetailService.create(createConsigneedetailDto);
  }

  @Get()
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const trx = await dbMssql.transaction();
    const sortParams = {
      sortBy: sortBy || 'consignee_id',
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
      const result = await this.consigneedetailService.findAll(params, trx);

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
    return this.consigneedetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateConsigneedetailDto: UpdateConsigneedetailDto,
  ) {
    return this.consigneedetailService.update(id, updateConsigneedetailDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.consigneedetailService.remove(id);
  }
}
