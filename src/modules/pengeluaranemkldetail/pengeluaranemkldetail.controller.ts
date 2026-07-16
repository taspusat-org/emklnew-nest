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
import { PengeluaranemkldetailService } from './pengeluaranemkldetail.service';
import { CreatePengeluaranemkldetailDto } from './dto/create-pengeluaranemkldetail.dto';
import { UpdatePengeluaranemkldetailDto } from './dto/update-pengeluaranemkldetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { InternalServerErrorException } from '@nestjs/common';
import { UpdateJurnalumumdetailDto } from '../jurnalumumdetail/dto/update-jurnalumumdetail.dto';

@Controller('pengeluaranemkldetail')
export class PengeluaranemkldetailController {
  constructor(
    private readonly pengeluaranemkldetailService: PengeluaranemkldetailService,
  ) {}

  @Post()
  create(@Body() createJurnalumumdetailDto: CreatePengeluaranemkldetailDto) {
    return this.pengeluaranemkldetailService.create(createJurnalumumdetailDto);
  }

  @Get('')
  async findAll(@Query() query: FindAllDto) {
    const { search, sortBy, sortDirection, ...filters } = query;

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
      const result = await this.pengeluaranemkldetailService.findAll(
        params,
        trx,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data marketing orderan in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch marketing orderan in controller',
      );
    }
  }
}
