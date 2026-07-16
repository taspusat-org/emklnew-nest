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
  Put,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { ParameterService } from './parameter.service';
import {
  CreateParameterDto,
  CreateParameterSchema,
} from './dto/create-parameter.dto';
import {
  UpdateParameterDto,
  UpdateParameterSchema,
} from './dto/update-parameter.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { dbMssql } from 'src/common/utils/db';
import { Response } from 'express';
import * as fs from 'fs';

@Controller('parameter')
export class ParameterController {
  constructor(private readonly parameterService: ParameterService) {}

  @Post()
  async create(
    @Body()
    createParameterDto: any,
  ) {
    const trx = await dbMssql.transaction(); // Start a new transaction
    try {
      // Call the service method with the transaction
      const result = await this.parameterService.create(
        createParameterDto,
        trx,
      );

      // Commit the transaction if everything is successful
      await trx.commit();
      return result;
    } catch (error) {
      // Rollback transaction if an error occurs
      await trx.rollback();
      throw new Error(`Error creating parameter: ${error.message}`);
    }
  }

  @Post('report-byselect')
  async findAllByIds(@Body() ids: { id: string }[]) {
    return this.parameterService.findAllByIds(ids);
  }

  @Post('/export-byselect')
  async exportToExcelBySelect(
    @Body() ids: { id: string }[],
    @Res() res: Response,
  ) {
    try {
      const data = await this.parameterService.findAllByIds(ids);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.parameterService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_parameter.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Get()
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const {
      search,
      page,
      limit,
      sortBy,
      sortDirection,
      isLookUp,
      exclude,
      ...filters
    } = query;

    const sortParams = {
      sortBy: sortBy || 'grp',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    const params: FindAllParams = {
      search,
      filters,
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean
      exclude,
      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    return this.parameterService.findAll(params);
  }
  @Get('approval')
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAllApproval(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'grp',
      sortDirection: sortDirection || 'asc',
    };

    const pagination = {
      page: page || 1, // Jika page tidak ada, set ke 1
      limit: limit === 0 || !limit ? undefined : limit, // Jika limit 0, tidak ada pagination
    };

    const params: FindAllParams = {
      search,
      filters,
      isLookUp: isLookUp === 'true', // Convert isLookUp to boolean

      pagination,
      sort: sortParams as { sortBy: string; sortDirection: 'asc' | 'desc' },
    };

    return this.parameterService.findAllApproval(params);
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      // Mengambil data dari findAll dengan params
      const { data } = await this.findAll(params);
      // Cek apakah data ada dan merupakan array
      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      // Memanggil service untuk menghasilkan file Excel
      const tempFilePath = await this.parameterService.exportToExcel(data);

      // Buat header untuk response download
      const fileStream = fs.createReadStream(tempFilePath);

      // Set response headers for Excel file download
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_parameter.xlsx"',
      );

      // Pipe the file stream to the response
      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.parameterService.getById(id, trx);
      if (!result) {
        throw new Error('Data not found');
      }

      await trx.commit();
      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);

      await trx.rollback();
      throw new Error('Failed to fetch data by id');
    }
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    updateParameterDto: any,
  ) {
    const trx = await dbMssql.transaction();
    try {
      // Mengubah ID menjadi number dan mengirimkan ke service
      const result = await this.parameterService.update(
        id,
        updateParameterDto,
        trx,
      );
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating parameter in controller:', error);
      throw new Error('Failed to update parameter');
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.parameterService.delete(id, trx);

      if (result.status === 404) {
        throw new NotFoundException(result.message);
      }

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error deleting menu in controller:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete menu');
    }
  }
  @Post('validate')
  async validateRows(@Body() body: { rows: { key: string; value: string }[] }) {
    try {
      const { rows } = body;

      if (!rows || !Array.isArray(rows)) {
        throw new BadRequestException('Invalid data format');
      }

      const validationResult = await this.parameterService.validateRows(rows);
      if (!validationResult.success) {
        return {
          status: false,
          errors: validationResult.errors,
          message: 'Validation completed with warnings.',
        };
      }

      return {
        status: true,
        message: 'Validation successful',
      };
    } catch (error) {
      console.error('Error validating rows:', error);
      throw new InternalServerErrorException('Internal server error');
    }
  }
}
