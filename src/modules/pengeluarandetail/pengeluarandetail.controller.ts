import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  InternalServerErrorException,
  Query,
} from '@nestjs/common';
import { PengeluarandetailService } from './pengeluarandetail.service';
import { CreatePengeluarandetailDto } from './dto/create-pengeluarandetail.dto';
import { UpdatePengeluarandetailDto } from './dto/update-pengeluarandetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('pengeluarandetail')
export class PengeluarandetailController {
  constructor(
    private readonly pengeluarandetailService: PengeluarandetailService,
  ) {}

  @Post()
  create(@Body() createPengeluarandetailDto: CreatePengeluarandetailDto) {
    return this.pengeluarandetailService.create(createPengeluarandetailDto);
  }

  @Get()
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

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

    const trx = await dbMssql.transaction();
    try {
      const result = await this.pengeluarandetailService.findAll(params, trx);

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pengeluarandetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePengeluarandetailDto: UpdatePengeluarandetailDto,
  ) {
    return this.pengeluarandetailService.update(
      id,
      updatePengeluarandetailDto,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pengeluarandetailService.remove(id);
  }
}
