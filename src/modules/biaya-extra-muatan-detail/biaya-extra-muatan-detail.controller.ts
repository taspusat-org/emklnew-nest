import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { BiayaExtraMuatanDetailService } from './biaya-extra-muatan-detail.service';
import { CreateBiayaExtraMuatanDetailDto } from './dto/create-biaya-extra-muatan-detail.dto';
import { UpdateBiayaExtraMuatanDetailDto } from './dto/update-biaya-extra-muatan-detail.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('biayaextramuatandetail')
export class BiayaExtraMuatanDetailController {
  constructor(
    private readonly biayaExtraMuatanDetailService: BiayaExtraMuatanDetailService,
  ) {}

  @Post()
  create(
    @Body() createBiayaExtraMuatanDetailDto: CreateBiayaExtraMuatanDetailDto,
  ) {
    return this.biayaExtraMuatanDetailService.create(
      createBiayaExtraMuatanDetailDto,
    );
  }

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
      // Header terpilih ikut sebagai filter, bukan argumen terpisah — service
      // memakainya untuk set_config('tas.biayaextra_id') + WHERE eksplisit.
      filters: { ...filters, biayaextra_id: id },
      pagination,
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.biayaExtraMuatanDetailService.findAll(
        params,
        trx,
      );
      await trx.commit();

      // Balikan diteruskan apa adanya, termasuk saat kosong: service sudah
      // mengisi `pagination` bahkan untuk hasil kosong, dan grid butuh
      // totalPages untuk berhenti di halaman terakhir.
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data biaya extra muatan detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch biaya extra muatan detail in controller',
      );
    }
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBiayaExtraMuatanDetailDto: UpdateBiayaExtraMuatanDetailDto,
  ) {
    return this.biayaExtraMuatanDetailService.update(
      id,
      updateBiayaExtraMuatanDetailDto,
    );
  }
}
