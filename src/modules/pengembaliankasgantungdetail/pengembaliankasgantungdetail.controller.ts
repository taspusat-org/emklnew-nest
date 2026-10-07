import {
  Controller,
  Get,
  Patch,
  Param,
  Delete,
  Body,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { PengembaliankasgantungdetailService } from './pengembaliankasgantungdetail.service';
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
      const result = await this.pengembaliankasgantungdetailService.findAll(
        params,
        trx,
      );
      await trx.commit();

      // Balikan diteruskan apa adanya, termasuk saat kosong. Dulu hasil kosong
      // ditukar objek tanpa `pagination`, sehingga grid tidak pernah tahu
      // totalPages dan windowed lazy-loading tidak bisa berhenti di halaman
      // terakhir. Service sudah mengisi pagination bahkan untuk hasil kosong.
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error fetching pengembalian kas gantung detail in controller',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch pengembalian kas gantung detail in controller',
      );
    }
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
