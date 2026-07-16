import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UsePipes,
  Req,
  UseGuards,
  InternalServerErrorException,
  NotFoundException,
  Put,
  Res,
} from '@nestjs/common';
import { AkunpusatService } from './akunpusat.service';
import {
  CreateAkunpusatDto,
  CreateAkunpusatSchema,
  UpdateAkunpusatDto,
  updateAkunPusatSchema,
} from './dto/create-akunpusat.dto';
import { dbMssql, createTransaction } from 'src/common/utils/db';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import * as fs from 'fs';
import { Response } from 'express';

@Controller('akunpusat')
export class AkunpusatController {
  constructor(private readonly akunpusatService: AkunpusatService) {}

  @UseGuards(AuthGuard)
  @Post()
  //@AKUN-PUSAT
  async create(
    @Body(new ZodValidationPipe(CreateAkunpusatSchema))
    data: CreateAkunpusatDto,
    @Req() req,
  ) {
    const trx = await createTransaction(dbMssql);

    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.akunpusatService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      throw new Error(`Error creating menu: ${error.message}`);
    }
  }

  @Get()
  //@AKUN-PUSAT
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'coa',
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

    const trx = await createTransaction(dbMssql);

    try {
      const result = await this.akunpusatService.findAll(params, trx);
      await trx.commit();

      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  //@AKUN-PUSAT
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAkunPusatSchema))
    data: UpdateAkunpusatDto,
    @Req() req,
  ) {
    const trx = await createTransaction(dbMssql);

    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.akunpusatService.update(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating akun pusat in controller:', error);
      throw new Error('Failed to update akun pusat');
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@AKUN-PUSAT
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await createTransaction(dbMssql);

    try {
      const result = await this.akunpusatService.delete(
        id,
        trx,
        req.user?.user?.username,
      );

      if (result.status === 404) {
        throw new NotFoundException(result.message);
      }

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting akun pusat in controller:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete akun pusat');
    }
  }
  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined');
      }

      const tempFilePath = await this.akunpusatService.exportToExcel(data);
      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_akunpusat.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }
}
