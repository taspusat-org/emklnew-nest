import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  UsePipes,
  Query,
  Put,
} from '@nestjs/common';
import { ConsigneeService } from './consignee.service';
import { CreateConsigneeDto } from './dto/create-consignee.dto';
import { UpdateConsigneeDto } from './dto/update-consignee.dto';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';

@Controller('consignee')
export class ConsigneeController {
  constructor(private readonly consigneeService: ConsigneeService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@CONSIGNEE
  async create(@Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.consigneeService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      console.error('Error in create:', error);
      await trx.rollback();

      // PENTING: Jangan wrap HttpException dengan Error baru
      if (error instanceof HttpException) {
        throw error; // Langsung throw HttpException yang sudah ada
      }

      // Untuk error lainnya yang bukan HttpException
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Get()
  //@CONSIGNEE
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'namaconsignee',
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
      const result = await this.consigneeService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.consigneeService.findOne(id);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@JURNAL-UMUM
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.consigneeService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      // PENTING: Jangan wrap HttpException dengan Error baru
      if (error instanceof HttpException) {
        throw error; // Langsung throw HttpException yang sudah ada
      }

      // Untuk error lainnya yang bukan HttpException
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Internal server error',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@JURNAL-UMUM
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.consigneeService.delete(id, trx, modifiedby);

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting packinglistheader:', error);
      throw new Error(`Error deleting packinglistheader: ${error.message}`);
    }
  }
}
