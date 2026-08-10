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
    // Endpoint baca: TANPA transaksi, lihat alatbayar.controller.ts.
    // Balikan diteruskan apa adanya, termasuk saat kosong. Dulu hasil kosong
    // ditukar objek tanpa `pagination`, sehingga grid tidak pernah tahu
    // totalPages dan windowed lazy-loading tidak bisa berhenti di halaman
    // terakhir. Service sudah mengisi pagination bahkan untuk hasil kosong.
    return this.kasgantungdetailService.findAll(params, dbMssql);
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
