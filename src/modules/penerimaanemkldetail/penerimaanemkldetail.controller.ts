import {
  Controller,
  Get,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { PenerimaanemkldetailService } from './penerimaanemkldetail.service';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('penerimaanemkldetail')
export class PenerimaanemkldetailController {
  constructor(
    private readonly penerimaanemkldetailService: PenerimaanemkldetailService,
  ) {}
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
      const result = await this.penerimaanemkldetailService.findAll(
        params,
        trx,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data penerimaan emkl detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch penerimaan emkl detail in controller',
      );
    }
  }
}
