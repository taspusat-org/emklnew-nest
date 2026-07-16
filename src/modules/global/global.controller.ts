import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
} from '@nestjs/common';
import { GlobalService } from './global.service';
import { CreateGlobalDto } from './dto/create-global.dto';
import { UpdateGlobalDto } from './dto/update-global.dto';
import { dbMssql } from 'src/common/utils/db';
import { ValidatorFactoryService } from '../validator-factory/validator-factory.service';

@Controller('global')
export class GlobalController {
  constructor(
    private readonly globalService: GlobalService,
    private readonly validatorFactoryService: ValidatorFactoryService,
  ) {}

  @Post('approval')
  async approval(@Body() body: any) {
    const trx = await dbMssql.transaction();
    try {
      const validator = await this.globalService.approval(body, trx);

      await trx.commit();
      return validator;
    } catch (error) {
      await trx.rollback();
      return error;
    }
  }
  @Post('nonapproval')
  async unapproval(@Body() body: any) {
    const trx = await dbMssql.transaction();
    try {
      const validator = await this.globalService.nonApproval(body, trx);

      await trx.commit();
      return validator;
    } catch (error) {
      await trx.rollback();
      return error;
    }
  }
  @Post('check-approval')
  async check(@Body() body: any) {
    const trx = await dbMssql.transaction();
    try {
      const validator = await this.globalService.checkData(body, trx);

      await trx.commit();
      return validator;
    } catch (error) {
      await trx.rollback();
      return error;
    }
  }
  // @Post()
  // create(@Body() createGlobalDto: CreateGlobalDto) {
  //   return this.globalService.create(createGlobalDto);
  // }
  // @Post('delete-validation')
  // async validateDelete(
  //   @Body() checks: { tableName: string; fieldName: string; fieldValue: any }[],
  // ) {
  //   const trx = await dbMssql.transaction();

  //   // Deklarasikan tipe untuk validationResults
  //   const validationResults: {
  //     tableName: string;
  //     fieldName: string;
  //     fieldValue: any;
  //     status: string;
  //     message: string;
  //   }[] = []; // Array untuk menyimpan hasil validasi

  //   try {
  //     // Panggil service untuk melakukan validasi
  //     const result = await this.globalService.validationDelete(checks, trx);

  //     // Masukkan hasil validasi ke dalam validationResults
  //     validationResults.push(...result);

  //     // Komit transaksi meskipun ada pengecekan yang gagal
  //     await trx.commit();

  //     return {
  //       statusCode: HttpStatus.OK,
  //       message: 'Validation completed.',
  //       data: validationResults,
  //     };
  //   } catch (error) {
  //     // Rollback transaksi jika ada error
  //     await trx.rollback();
  //     console.error('Error during validation:', error);

  //     return {
  //       statusCode: HttpStatus.OK,
  //       message: 'Validation completed with errors.',
  //       data: validationResults,
  //     };
  //   }
  // }
  // @Post('open-forceedit')
  // async openForceEdit(@Body() data: any) {
  //
  //   // Assuming trx is some form of transaction handling passed from TypeORM or a similar DB library.
  //   // In TypeORM you can use the QueryBuilder or use transaction API if needed.
  //   const trx = await dbMssql.transaction();
  //   try {
  //     const result = await this.globalService.openForceEdit(data, trx);
  //     await trx.commit();
  //     return {
  //       statusCode: HttpStatus.OK,
  //       message: 'Force edit opened successfully.',
  //       data: result,
  //     };
  //   } catch (error) {
  //     await trx.rollback();
  //     throw new Error(`Error: ${error.message}`);
  //   }
  // }
  @Get()
  findAll() {
    return this.globalService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.globalService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGlobalDto: UpdateGlobalDto) {
    return this.globalService.update(id, updateGlobalDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.globalService.remove(id);
  }
}
