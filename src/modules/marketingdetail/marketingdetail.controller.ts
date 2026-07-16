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
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { MarketingdetailService } from './marketingdetail.service';
import { CreateMarketingdetailDto } from './dto/create-marketingdetail.dto';
import { UpdateMarketingdetailDto } from './dto/update-marketingdetail.dto';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { FindAllDto, FindAllParams } from 'src/common/interfaces/all.interface';

@Controller('marketingdetail')
export class MarketingdetailController {
  constructor(
    private readonly marketingdetailService: MarketingdetailService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() data: any, @Req() req) {
    let result;

    const {
      sortBy,
      sortDirection,
      filters,
      search,
      page,
      limit,
      marketing_id,
      marketing_nama,
      marketingprosesfee_id,
      jenisprosesfee_nama,
      statuspotongbiayakantor_nama,
      statusaktif_nama,
      marketingdetail,
      ...insertData
    } = data;

    const trx = await dbMssql.transaction();

    try {
      if (marketingdetail.length > 0) {
        const marketingDetailData = marketingdetail.map((detail: any) => ({
          ...detail,
          marketing_id: marketing_id,
          marketingprosesfee_id: marketingprosesfee_id,
          modifiedby: req.user?.user?.modifiedby || 'unknown',
        }));

        result = await this.marketingdetailService.create(
          marketingDetailData,
          marketingprosesfee_id,
          trx,
        );
      } else {
        return {
          message: 'Tidak ada data marketing detail yg diinput',
        };
      }

      // const result = await this.marketingdetailService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating marketing in controller', error);

      // Ensure any other errors get caught and returned
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create marketing',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  async findAll(@Param('id') id: string, @Query() query: FindAllDto) {
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
      isLookUp: isLookUp === 'true',
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    const trx = await dbMssql.transaction();
    try {
      const result = await this.marketingdetailService.findAll(id, trx, params);

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error(
        'Error fetching data marketing detail in controller ',
        error,
        error.message,
      );
      throw new InternalServerErrorException(
        'Failed to fetch marketing detail in controller',
      );
    }
  }

  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;
    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;

    try {
      const forceEdit = await this.marketingdetailService.checkValidasi(
        aksi,
        value,
        editedby,
        trx,
      );
      trx.commit();
      return forceEdit;
    } catch (error) {
      trx.rollback();
      console.error('Error checking validation:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingdetailService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMarketingdetailDto: UpdateMarketingdetailDto,
  ) {
    return this.marketingdetailService.update(id, updateMarketingdetailDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.marketingdetailService.remove(id);
  }
}
