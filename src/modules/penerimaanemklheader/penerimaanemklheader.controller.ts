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
import { PenerimaanemklheaderService } from './penerimaanemklheader.service';
import { CreatePenerimaanemklheaderDto } from './dto/create-penerimaanemklheader.dto';
import { UpdatePenerimaanemklheaderDto } from './dto/update-penerimaanemklheader.dto';
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

@Controller('penerimaanemklheader')
export class PenerimaanemklheaderController {
  constructor(
    private readonly penerimaanemklheaderService: PenerimaanemklheaderService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@PENERIMAAN-EMKL-HEADER
  async create(@Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';
      const result = await this.penerimaanemklheaderService.create(data, trx);
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
  //@PENERIMAAN-EMKL-HEADER
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
      const result = await this.penerimaanemklheaderService.findAll(
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
  //@PENERIMAAN-EMKL-HEADER
  async update(@Param('id') id: string, @Body() data: any, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.penerimaanemklheaderService.update(
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
  //@PENERIMAAN-EMKL-HEADER
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    const modifiedby = req.user?.user?.username || 'unknown';
    try {
      const result = await this.penerimaanemklheaderService.delete(
        id,
        trx,
        modifiedby,
      );

      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error deleting penerimaanemklheader:', error);
      throw new Error(`Error deleting penerimaanemklheader: ${error.message}`);
    }
  }
  @Get('list-penerimaan')
  //@PENERIMAAN-EMKL-HEADER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllPenerimaan(@Query() query: { dari: string; sampai: string }) {
    const { dari, sampai } = query;
    const trx = await dbMssql.transaction();

    try {
      const result = await this.penerimaanemklheaderService.getPenerimaan(
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
  //@PENERIMAAN-EMKL-HEADER
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();

    try {
      const result = await this.penerimaanemklheaderService.findOne(id, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findOne:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }
  @Get('/export/:id')
  async exportToExcel(@Param('id') id: string, @Res() res: Response) {
    try {
      // Ambil data
      const trx = await dbMssql.transaction();
      const { data } = await this.penerimaanemklheaderService.findOne(id, trx);

      if (!Array.isArray(data)) {
        return res
          .status(HttpStatus.BAD_REQUEST)
          .send('Data is not an array or is undefined.');
      }

      // Buat Excel file
      const tempFilePath = await this.penerimaanemklheaderService.exportToExcel(
        data,
        trx,
      );

      // Stream file ke response
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_penerimaan_emkl.xlsx"',
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
      const forceEdit = await this.penerimaanemklheaderService.checkValidasi(
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
