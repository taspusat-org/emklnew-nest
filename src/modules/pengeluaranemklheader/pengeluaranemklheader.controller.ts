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
  Res,
  InternalServerErrorException,
} from '@nestjs/common';
import { PengeluaranemklheaderService } from './pengeluaranemklheader.service';
import { CreatePengeluaranemklheaderDto } from './dto/create-pengeluaranemklheader.dto';
import { UpdatePengeluaranemklheaderDto } from './dto/update-pengeluaranemklheader.dto';
import { dbMssql } from 'src/common/utils/db';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { Response } from 'express';
import * as fs from 'fs';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
@Controller('pengeluaranemklheader')
export class PengeluaranemklheaderController {
  constructor(
    private readonly pengeluaranemklheaderService: PengeluaranemklheaderService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PENGELUARAN-EMKL-HEADER
  async create(@Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.pengeluaranemklheaderService.create(data, trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error in create:', error);
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
  //@PENGELUARAN-EMKL-HEADER
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
      const result = await this.pengeluaranemklheaderService.findAll(
        params,
        trx,
      );
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
  //@PENGELUARAN-EMKL-HEADER
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.pengeluaranemklheaderService.update(
        id,
        data,
        trx,
      );

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating menu in controller:', error);
      throw new Error('Failed to update menu');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@PENGELUARAN-EMKL-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.pengeluaranemklheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting pengembalianjurnalumumheader:', error);
      throw new Error(
        `Error deleting pengembalianjurnalumumheader: ${error.message}`,
      );
    }
  }

  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.pengeluaranemklheaderService.findOne(id, trx);

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath =
        await this.pengeluaranemklheaderService.exportToExcel(data, trx);

      // Stream file ke response
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_pengeluaran_emkl.xlsx"',
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
  @Post('check-validation')
  @UseGuards(AuthGuard)
  async checkValidasi(@Body() body: { aksi: string; value: any }, @Req() req) {
    const { aksi, value } = body;

    const trx = await dbMssql.transaction();
    const editedby = req.user?.user?.username;
    try {
      const forceEdit = await this.pengeluaranemklheaderService.checkValidasi(
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
  @Get('list')
  //@PENGELUARAN-EMKL-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllPengeluaranEmkl(
    @Query() query: { dari: string; sampai: string },
  ) {
    const { dari, sampai } = query;
    const trx = await dbMssql.transaction();

    try {
      const result = await this.pengeluaranemklheaderService.getPengeluaranEmkl(
        dari,
        sampai,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Get('list-pengeluaran')
  //@PENGELUARAN-EMKL-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllPengeluaran(@Query() query: { dari: string; sampai: string }) {
    const { dari, sampai } = query;
    const trx = await dbMssql.transaction();

    try {
      const result = await this.pengeluaranemklheaderService.getPengeluaran(
        dari,
        sampai,
        trx,
      );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Get('pengembalian')
  //@PENGELUARAN-EMKL-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllPengembalian(
    @Query() query: { id: any; dari: string; sampai: string },
  ) {
    const { dari, sampai, id } = query;
    const trx = await dbMssql.transaction();
    try {
      const result =
        await this.pengeluaranemklheaderService.getPengembalianPinjaman(
          id,
          dari,
          sampai,
          trx,
        );
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @UseGuards(AuthGuard)
  @Get(':id')
  //@PENGELUARAN-EMKL-HEADER
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.pengeluaranemklheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
}
