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
import { PanjarmuatandetailService } from './panjarmuatandetail.service';
import { CreatePanjarmuatandetailDto } from './dto/create-panjarmuatandetail.dto';
import { UpdatePanjarmuatandetailDto } from './dto/update-panjarmuatandetail.dto';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';

@Controller('panjarmuatandetail')
export class PanjarmuatandetailController {
  constructor(
    private readonly panjarmuatandetailService: PanjarmuatandetailService,
  ) {}

  @Post()
  create(@Body() createPanjarmuatandetailDto: CreatePanjarmuatandetailDto) {
    return this.panjarmuatandetailService.create(createPanjarmuatandetailDto);
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
      const result = await this.panjarmuatandetailService.findAll(
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
        'Error fetching data panjar muatan detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch panjar muatan detail in controller',
      );
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.panjarmuatandetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePanjarmuatandetailDto: UpdatePanjarmuatandetailDto,
  ) {
    return this.panjarmuatandetailService.update(
      id,
      updatePanjarmuatandetailDto,
    );
  }
}
