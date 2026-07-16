import { Controller, Put, Body, Param, Req, UseGuards } from '@nestjs/common';
import { MenuService } from './menu.service';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';

@Controller('menu/resequence')
export class MenuResequenceController {
  constructor(private readonly menuService: MenuService) {}

  @UseGuards(AuthGuard)
  @Put()
  async resequence(
    @Body() body: { items: any[] }, // Pastikan data yang diterima adalah array
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      const { items } = body;

      // Pastikan items adalah array
      if (!Array.isArray(items)) {
        throw new Error("Expected 'items' to be an array.");
      }

      // Panggil service untuk melakukan resequencing
      await this.menuService.updateMenuResequence(items, 0, 0, trx);

      // Commit transaksi jika berhasil
      await trx.commit();

      return { status: 200, message: 'Menu sequence updated successfully' };
    } catch (error) {
      await trx.rollback();
      console.error('Error resequencing menu:', error);
      throw new Error('Failed to resequence menu');
    }
  }
}
