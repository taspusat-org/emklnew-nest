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
import { KasgantungdetailService } from './kasgantungdetail.service';
import { CreateKasgantungdetailDto } from './dto/create-kasgantungdetail.dto';
import { UpdateKasgantungdetailDto } from './dto/update-kasgantungdetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('kasgantungdetail')
export class KasgantungdetailController {
  constructor(
    private readonly kasgantungdetailService: KasgantungdetailService,
  ) {}

  @Post()
  create(@Body() createKasgantungdetailDto: CreateKasgantungdetailDto) {
    return this.kasgantungdetailService.create(createKasgantungdetailDto);
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
      const result = await this.kasgantungdetailService.findAll(params, trx);

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

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateKasgantungdetailDto: UpdateKasgantungdetailDto,
  ) {
    return this.kasgantungdetailService.update(id, updateKasgantungdetailDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.kasgantungdetailService.remove(id);
  }
}
