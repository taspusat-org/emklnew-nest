import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UsePipes,
  Query,
  InternalServerErrorException,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ScheduleKapalService } from './schedule-kapal.service';
import {
  CreateScheduleKapalDto,
  CreateScheduleKapalSchema,
} from './dto/create-schedule-kapal.dto';
// import { UpdateScheduleKapalDto } from './dto/update-schedule-kapal.dto';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';

@Controller('schedule-kapal')
export class ScheduleKapalController {
  constructor(private readonly scheduleKapalService: ScheduleKapalService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@SCHEDULE-KAPAL
  async create(
    @Body(
      new ZodValidationPipe(CreateScheduleKapalSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateScheduleKapalDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.scheduleKapalService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error(
        'Error while creating schedule kapal in controller be',
        error,
      );

      if (error instanceof HttpException) {
        // Ensure any other errors get caught and returned
        throw error; // If it's already a HttpException, rethrow it
      }

      throw new HttpException( // Generic error handling, if something unexpected happens
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create schedule kapal in controller be',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  //@SCHEDULE-KAPAL
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'keterangan',
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
      const result = await this.scheduleKapalService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching all schedule kapal in controller:',
        error,
        'ini error message',
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch schedule kapal in controller',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.scheduleKapalService.update(id, 'aa');
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.scheduleKapalService.remove(id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.scheduleKapalService.findOne(id);
  }
}
