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
import { HutangdetailService } from './hutangdetail.service';
import { CreateHutangdetailDto } from './dto/create-hutangdetail.dto';
import { UpdateHutangdetailDto } from './dto/update-hutangdetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('hutangdetail')
export class HutangdetailController {
  constructor(private readonly hutangdetailService: HutangdetailService) {}

  @Post()
  create(@Body() createHutangdetailDto: CreateHutangdetailDto) {
    return this.hutangdetailService.create(createHutangdetailDto);
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
      const result = await this.hutangdetailService.findAll(params, trx);

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
      await trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hutangdetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() UpdateHutangdetailDto: UpdateHutangdetailDto,
  ) {
    return this.hutangdetailService.update(id, UpdateHutangdetailDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.hutangdetailService.remove(id);
  }
}
