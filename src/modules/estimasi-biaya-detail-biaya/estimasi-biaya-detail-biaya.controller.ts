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
  UseGuards,
} from '@nestjs/common';
import { EstimasiBiayaDetailBiayaService } from './estimasi-biaya-detail-biaya.service';
import { CreateEstimasiBiayaDetailBiayaDto } from './dto/create-estimasi-biaya-detail-biaya.dto';
import { UpdateEstimasiBiayaDetailBiayaDto } from './dto/update-estimasi-biaya-detail-biaya.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';

@Controller('estimasibiayadetailbiaya')
export class EstimasiBiayaDetailBiayaController {
  constructor(
    private readonly estimasiBiayaDetailBiayaService: EstimasiBiayaDetailBiayaService,
  ) {}

  @Post()
  create(
    @Body()
    createEstimasiBiayaDetailBiayaDto: CreateEstimasiBiayaDetailBiayaDto,
  ) {
    return this.estimasiBiayaDetailBiayaService.create(
      createEstimasiBiayaDetailBiayaDto,
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
      const result = await this.estimasiBiayaDetailBiayaService.findAll(
        id,
        trx,
        params,
      );
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
      trx.rollback();
      console.error(
        'Error fetching data estimasi biaya detail biaya in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch estimasi biaya detail biaya in controller',
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.estimasiBiayaDetailBiayaService.findOne(
        id,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne estimasi biaya detail biaya:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    updateEstimasiBiayaDetailBiayaDto: UpdateEstimasiBiayaDetailBiayaDto,
  ) {
    return this.estimasiBiayaDetailBiayaService.update(
      id,
      updateEstimasiBiayaDetailBiayaDto,
    );
  }
}
