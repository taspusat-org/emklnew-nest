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
} from '@nestjs/common';
import { LogtrailService } from './logtrail.service';
import { CreateLogtrailDto } from './dto/create-logtrail.dto';
import { UpdateLogtrailDto } from './dto/update-logtrail.dto';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from '../interfaces/all.interface';
import { dbMssql } from '../utils/db';

@Controller('logtrail')
export class LogtrailController {
  constructor(private readonly logtrailService: LogtrailService) {}

  @Post()
  async create(@Body() createLogtrailDto: CreateLogtrailDto) {
    return 'this.logtrailService.create(createLogtrailDto)';
  }

  @Get()
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'namatabel',
      sortDirection: sortDirection || 'asc',
    };
    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    const params: FindAllParams = {
      search,
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean

      filters,
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };
    const trx = await dbMssql.transaction();
    try {
      const result = await this.logtrailService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error;
    }
  }
  @Get(':id/header')
  async processHeader(
    @Param('id') id: number,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
    @Query('sortKey') sortKey: string = 'id',
    @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'asc',
  ) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.logtrailService.processHeader(
        id,
        page,
        pageSize,
        sortKey,
        sortOrder,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error;
    }
  }

  @Get(':id/detail')
  async processDetail(
    @Param('id') id: number,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
    @Query('sortKey') sortKey: string = 'id',
    @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'asc',
  ) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.logtrailService.processDetail(
        id,
        page,
        pageSize,
        sortKey,
        sortOrder,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error;
    }
  }
}
