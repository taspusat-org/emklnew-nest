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
import { PengembaliankasgantungdetailService } from './pengembaliankasgantungdetail.service';
import { CreatePengembaliankasgantungdetailDto } from './dto/create-pengembaliankasgantungdetail.dto';
import { UpdatePengembaliankasgantungdetailDto } from './dto/update-pengembaliankasgantungdetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('pengembaliankasgantungdetail')
export class PengembaliankasgantungdetailController {
  constructor(
    private readonly pengembaliankasgantungdetailService: PengembaliankasgantungdetailService,
  ) {}

  @Get()
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };
    const params: FindAllParams = {
      search,
      filters,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };
    const trx = await dbMssql.transaction();
    try {
      const result = await this.pengembaliankasgantungdetailService.findAll(
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
      await trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Get()
  async tes(
    @Query()
    query: {
      tanggalDari: string;
      tanggalSampai: string;
    },
  ) {
    const { tanggalDari, tanggalSampai } = query;
    const result = await this.pengembaliankasgantungdetailService.tes(
      tanggalDari,
      tanggalSampai,
    );
    return result;
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    updatePengembaliankasgantungdetailDto: UpdatePengembaliankasgantungdetailDto,
  ) {
    return this.pengembaliankasgantungdetailService.update(
      id,
      updatePengembaliankasgantungdetailDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pengembaliankasgantungdetailService.remove(id);
  }
}
