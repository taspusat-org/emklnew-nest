import {
  Controller,
  Get,
  Param,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { PanjarmuatandetailService } from './panjarmuatandetail.service';
import {
  FindAllDto,
  FindAllParams,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('panjarmuatandetail')
export class PanjarmuatandetailController {
  constructor(
    private readonly panjarmuatandetailService: PanjarmuatandetailService,
  ) {}

  /**
   * `id` = panjar_id header yang sedang dipilih di grid.
   *
   * Endpoint POST/PATCH lama DIHAPUS: keduanya stub yang tidak pernah jalan
   * (create dipanggil tanpa trx, update hanya memulangkan template string) dan
   * tidak dipakai frontend. Detail panjar SELALU ditulis lewat
   * PanjarheaderService (satu transaksi bersama header-nya).
   */
  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nobukti',
      sortDirection: sortDirection || 'asc',
    };

    // Query string selalu string. Tanpa Number() di sini, offset dihitung dari
    // ('2' - 1) * '50' — kebetulan benar lewat koersi JS, tapi limit tetap
    // string dan Math.ceil(total / '50') ikut bergantung koersi. Eksplisit saja.
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
      const result = await this.panjarmuatandetailService.findAll(
        id,
        trx,
        params,
      );
      await trx.commit();

      // Balikan diteruskan apa adanya, termasuk saat kosong. Dulu hasil kosong
      // ditukar dengan objek tanpa `pagination`, sehingga grid tidak pernah tahu
      // totalPages dan windowed lazy-loading tidak bisa berhenti di halaman
      // terakhir. Service sudah mengisi pagination bahkan untuk hasil kosong.
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error fetching data panjar muatan detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch panjar muatan detail in controller',
      );
    }
  }
}
