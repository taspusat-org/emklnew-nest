import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UsePipes,
} from '@nestjs/common';
import { PenerimaandetailService } from './penerimaandetail.service';
import { CreatePenerimaandetailDto } from './dto/create-penerimaandetail.dto';
import { UpdatePenerimaandetailDto } from './dto/update-penerimaandetail.dto';
import { dbMssql } from 'src/common/utils/db';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';

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
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    // nobukti default string kosong: service memakainya sebagai penanda
    // "header belum dipilih" dan membalas hasil kosong yang tetap berbentuk
    // lengkap.
    const finalFilters = {
      nobukti: '',
      ...filters,
    };

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
      filters: finalFilters,
      pagination,
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.penerimaandetailService.findAll(params, trx);
      await trx.commit();

      // Balikan diteruskan apa adanya, termasuk saat kosong. Dulu hasil kosong
      // ditukar dengan objek tanpa `pagination`, sehingga grid tidak pernah tahu
      // totalPages dan windowed lazy-loading tidak bisa berhenti di halaman
      // terakhir. Service sudah mengisi pagination bahkan untuk hasil kosong.
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.penerimaandetailService.findOne(id);
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
