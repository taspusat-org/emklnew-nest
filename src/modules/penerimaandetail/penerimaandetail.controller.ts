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
import { PenerimaandetailService } from './penerimaandetail.service';
import { CreatePenerimaandetailDto } from './dto/create-penerimaandetail.dto';
import { UpdatePenerimaandetailDto } from './dto/update-penerimaandetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('penerimaandetail')
export class PenerimaandetailController {
  constructor(
    private readonly penerimaandetailService: PenerimaandetailService,
  ) {}

  @Post()
  create(@Body() createPenerimaandetailDto: CreatePenerimaandetailDto) {
    return this.penerimaandetailService.create(createPenerimaandetailDto);
  }

  @Get()
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    // Set nobukti menjadi string kosong jika tidak ada
    const finalFilters = {
      nobukti: '',
      ...filters,
    };

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };

    const params: FindAllParams = {
      search,
      filters: finalFilters,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();

    try {
      const result = await this.penerimaandetailService.findAll(params, trx);

      if (result?.data.length === 0) {
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
    @Body() updatePenerimaandetailDto: UpdatePenerimaandetailDto,
  ) {
    return this.penerimaandetailService.update(id, updatePenerimaandetailDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.penerimaandetailService.remove(id);
  }
}
