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
  Put,
  InternalServerErrorException,
  HttpException,
  HttpStatus,
  Res,
  UsePipes,
  Query,
} from '@nestjs/common';
import { PackinglistheaderService } from './packinglistheader.service';
import { CreatePackinglistheaderDto } from './dto/create-packinglistheader.dto';
import { UpdatePackinglistheaderDto } from './dto/update-packinglistheader.dto';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { Response } from 'express';
import * as fs from 'fs';
@Controller('packinglistheader')
export class PackinglistheaderController {
  constructor(
    private readonly packinglistheaderService: PackinglistheaderService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.packinglistheaderService.create(data, trx);
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
  //@JURNAL-UMUM
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'nobukti',
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
      const result = await this.packinglistheaderService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  //@JURNAL-UMUM
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.packinglistheaderService.update(id, data, trx);

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
      const result = await this.packinglistheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting packinglistheader:', error);
      throw new Error(`Error deleting packinglistheader: ${error.message}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get(':id')
  //@JURNAL-UMUM
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.packinglistheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Get('report/:id')
  //@JURNAL-UMUM
  async getPackingListPivotReport(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.packinglistheaderService.getPackingListReport(
        id,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @UseGuards(AuthGuard)
  @Get('reportsttb/:id')
  //@JURNAL-UMUM
  async getPackingListSimpleReport(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result =
        await this.packinglistheaderService.getPackingListSimpleReport(
          id,
          trx,
        );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  // @Get('/export/:id')
  // async exportToExcel(@Param('id') id: string, @Res() res: Response) {
  //   try {
  //     // Ambil data
  //     const trx = await dbMssql.transaction();
  //     const { data } = await this.packinglistheaderService.findOne(id, trx);

  //     if (!Array.isArray(data)) {
  //       return res
  //         .status(HttpStatus.BAD_REQUEST)
  //         .send('Data is not an array or is undefined.');
  //     }

  //     // Buat Excel file
  //     const tempFilePath = await this.packinglistheaderService.exportToExcel(
  //       data,
  //       trx,
  //     );

  //     // Stream file ke response
  //     res.setHeader(
  //       'Content-Type',
  //       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  //     );
  //     res.setHeader(
  //       'Content-Disposition',
  //       'attachment; filename="laporan_jurnal_umum.xlsx"',
  //     );

  //     const fileStream = fs.createReadStream(tempFilePath);
  //     fileStream.pipe(res);

  //     // Optional: hapus file temp setelah selesai streaming
  //     fileStream.on('end', () => {
  //       fs.unlink(tempFilePath, (err) => {
  //         if (err) console.error('Error deleting temp file:', err);
  //       });
  //     });
  //   } catch (error) {
  //     console.error('Error exporting to Excel:', error);
  //     return res
  //       .status(HttpStatus.INTERNAL_SERVER_ERROR)
  //       .send('Failed to export file');
  //   }
  // }
  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;

    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;
    try {
      const forceEdit = await this.packinglistheaderService.checkValidasi(
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
}
