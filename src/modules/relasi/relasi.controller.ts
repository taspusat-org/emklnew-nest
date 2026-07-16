import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UsePipes,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { RelasiService } from './relasi.service';
import { CreateRelasiDto } from './dto/create-relasi.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { UpdateRelasiDto } from './dto/update-relasi.dto';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
@Controller('relasi')
export class RelasiController {
  constructor(private readonly relasiService: RelasiService) {}

  @Post()
  //@RELASI
  async create(@Body() createRelasiDto: CreateRelasiDto) {
    const trx = await dbMssql.transaction();
    return this.relasiService.create(createRelasiDto, trx);
  }

  @Get()
  //@RELASI
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nama',
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
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
      isLookUp: isLookUp === 'true',
    };
    const trx = await dbMssql.transaction();

    try {
      const result = await this.relasiService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw new InternalServerErrorException('Failed to fetch Relasi');
      // throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.relasiService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateRelasiDto: UpdateRelasiDto,
  ) {
    const trx = await dbMssql.transaction();
    return this.relasiService.update(id, updateRelasiDto, trx);
  }
}
