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
  NotFoundException,
  UsePipes,
  Query,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, CreateUserSchema } from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserSchema } from './dto/update-user.dto';
import { AuthGuard } from '../auth/auth.guard';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { dbMssql } from 'src/common/utils/db';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { Response } from 'express'; // Import Response dari Express untuk menangani respons stream
import ExcelJS, { Workbook } from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { isRecordExist } from 'src/utils/utils.service';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}
  @Get('create-temporary-table')
  async createTemporaryTable() {
    return await this.userService.createTemporaryTable();
  }

  @Post('report-byselect')
  async findAllByIds(@Body() ids: { id: string }[]) {
    return this.userService.findAllByIds(ids);
  }

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateUserSchema)) data: CreateUserDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    const usernameexist = await isRecordExist(
      'username',
      data.username,
      'users',
    );
    if (usernameexist) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Username sudah ada', // Custom message
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.userService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      throw new Error(`Error creating parameter: ${error.message}`);
    }
  }

  @Get()
  @UseGuards(AuthGuard)
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'username',
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

    return this.userService.findAll(params);
  }

  @UseGuards(AuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string, // Grab the id from the URL
    @Body(new ZodValidationPipe(UpdateUserSchema)) data: UpdateUserDto, // Pass the input data
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      const usernameExists = await isRecordExist(
        'username',
        data.username,
        'users',
        Number(id),
      );
      if (usernameExists) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Username sudah ada', // Custom message
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.userService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating parameter in controller:', error);

      // Ensure any other errors get caught and returned
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update parameter',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
      const tempFilePath = await this.userService.exportToExcel(data);

      // Buat header untuk response download
      const fileStream = fs.createReadStream(tempFilePath);

      // Set response headers for Excel file download
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_user.xlsx"',
      );

      // Pipe the file stream to the response
      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Post('/export-byselect')
  async exportToExcelBySelect(
    @Body() ids: { id: string }[],
    @Res() res: Response,
  ) {
    try {
      const data = await this.userService.findAllByIds(ids);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.userService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_user.xlsx"',
      );

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
      const result = await this.userService.getById(id, trx);
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
  @UseGuards(AuthGuard)
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.userService.delete(
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
      console.error('Error deleting data in controller:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete data');
    }
  }
  @Get('temporary-data')
  async getTemporaryData() {
    try {
      const result = await this.userService.selectFromTemporaryTable();
      return {
        message: 'Temporary data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error fetching temporary data:', error);
      throw new InternalServerErrorException('Failed to fetch temporary data');
    }
  }
}
