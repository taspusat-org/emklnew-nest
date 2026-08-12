import {
  Controller,
  Get,
  Param,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { ScheduleDetailService } from './schedule-detail.service';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('schedule-detail')
export class ScheduleDetailController {
  constructor(private readonly scheduleDetailService: ScheduleDetailService) {}

  // Rincian schedule tidak punya endpoint tulis sendiri: create/update/delete
  // seluruhnya lewat header (POST/PUT /schedule-header) supaya header dan
  // rinciannya tersimpan dalam satu transaksi.
  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'id',
      sortDirection: sortDirection || 'asc',
    };

    // Query string selalu string. Tanpa Number() di sini offset/totalPages
    // bergantung pada koersi JS.
    const numericLimit = Number(limit);
    const pagination = {
      page: Number(page) || 1,
      limit:
        !numericLimit || Number.isNaN(numericLimit) ? undefined : numericLimit,
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
      const result = await this.scheduleDetailService.findAll(id, trx, params);
      await trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error fetching data schedule detail in controller', error);
      throw new InternalServerErrorException(
        'Failed to fetch schedule detail in controller',
      );
    }
  }
}
