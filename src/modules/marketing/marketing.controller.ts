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
  UsePipes,
  Query,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Put,
  Res,
} from '@nestjs/common';
import { MarketingService } from './marketing.service';
import {
  CreateMarketingDto,
  CreateMarketingSchema,
  UpdateMarketingDto,
  UpdateMarketingSchema,
} from './dto/create-marketing.dto';
// import { UpdateMarketingDto } from './dto/update-marketing.dto';
import * as fs from 'fs';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { Response } from 'express';

@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@MARKETING
  async create(
    @Body(
      new ZodValidationPipe(CreateMarketingSchema),
      KeyboardOnlyValidationPipe,
    )
    data: CreateMarketingDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.modifiedby || 'unknown';
      const result = await this.marketingService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating marketing in controller', error);

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

  @Get()
  //@MARKETING
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
      const result = await this.marketingService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll Controller Marketing:', error);
      throw new InternalServerErrorException(
        'Failed to fetch marketing in controller',
      );
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@MARKETING
  async update(
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(UpdateMarketingSchema),
      KeyboardOnlyValidationPipe,
    )
    data: UpdateMarketingDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      //
      const result = await this.marketingService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating marketing in controller:', error);
      throw new Error('Failed to update marketing in controller');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@MARKETING
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.marketingService.delete(id, trx, modifiedby);

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting marketing in controller:', error);
      // HttpException (mis. BadRequestException "masih dipakai") diteruskan apa
      // adanya; `throw new Error(...)` membuat semuanya jadi 500 tanpa pesan.
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error deleting marketing in controller: ${error.message}`,
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
      const forceEdit = await this.marketingService.checkValidasi(
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

  @Get('/getLookupKaryawan')
  async findAllLookupKaryawan(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'namakaryawan',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    const params: FindAllParams = {
      search,
      filters,
      pagination,
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    return this.marketingService.findAllLookupKaryawan(params);
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath = await this.marketingService.exportToExcel(data, trx);

      // Stream file ke response
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_managermarketing.xlsx"',
      );

      const fileStream = fs.createReadStream(tempFilePath);
      fileStream.pipe(res);

      // Optional: hapus file temp setelah selesai streaming
      fileStream.on('end', () => {
        fs.unlink(tempFilePath, (err) => {
          if (err) console.error('Error deleting temp file:', err);
        });
      });
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Failed to export file');
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.marketingService.findOne(id);
  }
}
