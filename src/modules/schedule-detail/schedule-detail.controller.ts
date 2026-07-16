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
import { ScheduleDetailService } from './schedule-detail.service';
import { CreateScheduleDetailDto } from './dto/create-schedule-detail.dto';
import { UpdateScheduleDetailDto } from './dto/update-schedule-detail.dto';
import { dbMssql } from 'src/common/utils/db';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('schedule-detail')
export class ScheduleDetailController {
  constructor(private readonly scheduleDetailService: ScheduleDetailService) {}

  @Post()
  create(@Body() createScheduleDetailDto: CreateScheduleDetailDto) {
    return this.scheduleDetailService.create(createScheduleDetailDto);
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
      const result = await this.scheduleDetailService.findAll(id, trx, params);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data schedule detail in controller ',
        error,
      );
      throw new InternalServerErrorException(
        'Failed to fetch schedule detail in controller',
      );
    }
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateScheduleDetailDto: UpdateScheduleDetailDto,
  ) {
    return this.scheduleDetailService.update(id, updateScheduleDetailDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scheduleDetailService.remove(id);
  }
}
