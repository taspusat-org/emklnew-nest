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
import { HutangdetailService } from './hutangdetail.service';
import { CreateHutangdetailDto } from './dto/create-hutangdetail.dto';
import { UpdateHutangdetailDto } from './dto/update-hutangdetail.dto';
import { dbMssql } from 'src/common/utils/db';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';

@Controller('hutangdetail')
export class HutangdetailController {
  constructor(private readonly hutangdetailService: HutangdetailService) {}

  @Post()
  create(@Body() createHutangdetailDto: CreateHutangdetailDto) {
    return this.hutangdetailService.create(createHutangdetailDto);
  }

  @Get()
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
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
      const result = await this.hutangdetailService.findAll(params, trx);
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
