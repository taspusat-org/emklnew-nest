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
  NotFoundException,
  InternalServerErrorException,
  UsePipes,
  Query,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateMenuDto, CreateMenuSchema } from './dto/create-menu.dto';
import { dbMssql } from 'src/common/utils/db';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateMenuDto, UpdateMenuSchema } from './dto/update-menu.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { Response } from 'express';
import * as fs from 'fs';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { UtilsService } from 'src/utils/utils.service';
import { ExportJobService } from 'src/common/report/export-job.service';
import { ExportMenuDto, ExportMenuSchema } from './dto/export-menu.dto';
import { ReportUserDto, ReportUserSchema } from '../user/dto/report-user.dto';
import { ReportJobService } from 'src/common/report/report-job.service';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly utilsService: UtilsService,
    private readonly exportJobService: ExportJobService,
    private readonly reportJobService: ReportJobService,
  ) {}
  @Get('sidebar')
  menuSidebar(@Query('userId') userId: number) {
    return this.menuService.getMenuSidebar(userId);
  }
  @Get('menu-sidebar')
  menuSidebarUser(@Query('userId') userId: number) {
    return this.menuService.getDataMenuSidebar(userId);
  }
  @Get('menu-resequence')
  menuResequence() {
    return this.menuService.getMenuResequence();
  }
  @Post('search')
  async getSearchMenu(
    @Body() { userId, search }: { userId: number; search: string },
  ) {
    try {
      const menus = await this.menuService.getSearchMenu(userId, search);
      return { data: menus };
    } catch (error) {
      console.error('Error searching menu:', error);
      throw new InternalServerErrorException('Failed to fetch search menus');
    }
  }

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateMenuSchema), KeyboardOnlyValidationPipe)
    data: CreateMenuDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.menuService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating menu in controller', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create menu',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Post('report')
  async report(
    @Body(new ZodValidationPipe(ReportUserSchema))
    body: ReportUserDto,
    @Req() req,
  ) {
    const { mrtName, search, filters, sortBy, sortDirection, judullaporan } =
      body;

    const username = req.user?.user?.username ?? 'unknown';

    return this.reportJobService.start({
      mrtName,
      loadData: async () => {
        // Sengaja TANPA transaksi: ini murni pembacaan untuk laporan, dan
        // job-nya berumur panjang (render bisa menit-an). Membuka transaksi
        // di sini hanya menahan koneksi ke database remote lebih lama tanpa
        // manfaat konsistensi apa pun. `findAll` cukup menerima instance knex
        // karena hanya memakai API baca (from/raw/count).
        const result = await this.menuService.findAll(
          {
            search,
            filters: (filters ?? {}) as Record<string, string | number>,
            // limit 0 = tanpa paging, ambil semua baris yang lolos filter.
            pagination: { page: 1, limit: 0 },
            sort: {
              sortBy: sortBy || 'username',
              sortDirection: sortDirection || 'asc',
            },
            isLookUp: false,
          },
          dbMssql,
        );

        const rows = Array.isArray(result?.data) ? result.data : [];

        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const tglcetak =
          `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ` +
          `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        // Kolom tambahan di bawah dipakai header template .mrt.
        return rows.map((row: any) => ({
          ...row,
          judullaporan: judullaporan ?? 'Laporan Menu',
          usercetak: username,
          tglcetak,
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        }));
      },
    });
  }

  @Get()
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'title',
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
      const result = await this.menuService.findAll(params, trx);
      trx.commit();
      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error fetching all menus:', error);
      throw new InternalServerErrorException('Failed to fetch menus');
    }
  }

  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportMenuSchema)) body: ExportMenuDto,
  ) {
    const { search, filters, sortBy, sortDirection } = body;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const queryParams = {
      search,
      filters: (filters ?? {}) as Record<string, string | number>,
      sort: {
        sortBy: sortBy || 'title',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
    };

    return this.exportJobService.start({
      filename: `laporan_menu_${stamp}.xlsx`,
      countRows: () => this.menuService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.menuService.buildExportQuery(queryParams, dbMssql).stream(),
      sheet: this.menuService.exportSheet,
    });
  }

  @Get('/export')
  async exportToExcel(@Query() params: any, @Res() res: Response) {
    try {
      const { data } = await this.findAll(params);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.menuService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_menu.xlsx"',
      );

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
      const data = await this.menuService.findAllByIds(ids);

      if (!Array.isArray(data)) {
        throw new Error('Data is not an array or is undefined.');
      }

      const tempFilePath = await this.menuService.exportToExcel(data);

      const fileStream = fs.createReadStream(tempFilePath);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="laporan_menu.xlsx"',
      );

      fileStream.pipe(res);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      res.status(500).send('Failed to export file');
    }
  }

  @Get('/permission/:id')
  async permission(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.utilsService.fetchUserRolesAndAbilities(
        id,
        trx,
      );
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
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.menuService.getById(id, trx);
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
  @Put('update-resequence')
  async updateMenuResequence(@Body() body: { data: any[] }, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const { data } = body;

      if (!Array.isArray(data)) {
        throw new Error("Expected 'data' to be an array.");
      }

      // Pass the extracted array to the service method along with the transaction
      await this.menuService.updateMenuResequence(data, 0, 0, trx);

      // If everything goes well, commit the transaction
      await trx.commit();
      return { message: 'Menu sequence updated successfully' };
    } catch (error) {
      // Rollback the transaction in case of error
      await trx.rollback();
      console.error('Error updating menu sequence in controller:', error);
      throw new InternalServerErrorException('Failed to update menu sequence');
    }
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMenuSchema)) data: UpdateMenuDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.menuService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating menu in controller:', error);

      if (error instanceof HttpException) throw error;

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update menu',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req) {
    const trx = await dbMssql.transaction();
    try {
      const result = await this.menuService.delete(
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
      console.error('Error deleting menu in controller:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete menu');
    }
  }
}
