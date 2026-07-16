import { Controller, Get, Query } from '@nestjs/common';
import { RunningNumberService } from './running-number.service';
import { dbMssql } from 'src/common/utils/db';

@Controller('running-number')
export class RunningNumberController {
  constructor(private readonly runningNumberService: RunningNumberService) {}

  @Get('generate')
  async generateRunningNumber(
    @Query('group') group: string,
    @Query('subGroup') subGroup: string,
    @Query('table') table: string,
    @Query('tgl') tgl: string,
    @Query('tujuan') tujuan: string | null,
    @Query('cabang') cabang: string | null,
    @Query('jenisbiaya') jenisbiaya: string | null,
    @Query('marketing') marketing: string | null,
    @Query('pelayaran') pelayaran: string | null,
    @Query('field') field: string | null,
  ): Promise<string> {
    const trx = await dbMssql.transaction();
    try {
      console.log('tujuan', tujuan);
      console.log('cabang', cabang);
      console.log('jenisbiaya', jenisbiaya);
      console.log('marketing', marketing);
      console.log('field', field);
      const result = await this.runningNumberService.generateRunningNumber(
        trx, // transaction if you need one
        group,
        subGroup,
        table,
        tgl,
        cabang,
        tujuan,
        jenisbiaya,
        marketing,
        pelayaran,
        field,
      );
      await trx.commit();
      return result;
    } catch (error) {
      console.error('Error generating running number:', error);
      await trx.rollback();
      throw new Error('Failed to generate running number');
    }
  }
}
