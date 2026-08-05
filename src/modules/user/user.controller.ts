import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  UsePipes,
  Query,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, CreateUserSchema } from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserSchema } from './dto/update-user.dto';
import { ReportUserDto, ReportUserSchema } from './dto/report-user.dto';
import { ExportUserDto, ExportUserSchema } from './dto/export-user.dto';
import {
  FindAllDto,
  FindAllParams,
  FindAllSchema,
} from 'src/common/interfaces/all.interface';
import { KeyboardOnlyValidationPipe } from 'src/common/pipes/keyboardonly-validation.pipe';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { dbMssql } from 'src/common/utils/db';
import { ReportJobService } from 'src/common/report/report-job.service';
import { ExportJobService } from 'src/common/report/export-job.service';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly reportJobService: ReportJobService,
    private readonly exportJobService: ExportJobService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  //@USER
  async create(
    @Body(new ZodValidationPipe(CreateUserSchema), KeyboardOnlyValidationPipe)
    data: CreateUserDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.userService.create(data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error while creating User in controller', error);

      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to create User',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Berbeda dari template groupbiayaextra yang findAll-nya terbuka: daftar user
  // memuat username & email, jadi AuthGuard-nya dipertahankan seperti semula.
  @Get()
  @UseGuards(AuthGuard)
  //@USER
  @UsePipes(new ZodValidationPipe(FindAllSchema))
  async findAll(@Query() query: FindAllDto) {
    const { search, page, limit, sortBy, sortDirection, isLookUp, ...filters } =
      query;

    const sortParams = {
      sortBy: sortBy || 'username',
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
      const result = await this.userService.findAll(params, trx);
      trx.commit();

      return result;
    } catch (error) {
      trx.rollback();
      console.error('Error in findAll:', error);
      throw error; // Re-throw the error to be handled by the global exception filter
    }
  }

  @UseGuards(AuthGuard)
  @Put('update/:id')
  //@USER
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema))
    data: UpdateUserDto,
    @Req() req,
  ) {
    const trx = await dbMssql.transaction();
    try {
      data.modifiedby = req.user?.user?.username || 'unknown';

      const result = await this.userService.update(id, data, trx);

      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();
      console.error('Error updating User in controller:', error);
      if (error instanceof HttpException) {
        throw error; // If it's already a HttpException, rethrow it
      }

      // Generic error handling, if something unexpected happens
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to update User',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  //@USER
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
      console.error('Error deleting User in controller:', error);

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to delete User');
    }
  }

  /**
   * POST /user/report
   *
   * Cetak laporan di background. Request langsung balas { jobId }; progres
   * render dikirim lewat socket namespace `/report` (event `report:progress`,
   * room = jobId), dan PDF-nya diambil di GET /report/download/:jobId.
   *
   * Data laporan diambil lewat findAll() milik service ini dengan limit 0,
   * jadi filter kolom / search global / sort yang dikirim frontend berperilaku
   * persis sama seperti yang tampil di grid — hanya saja tanpa paging.
   */
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
        const result = await this.userService.findAll(
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
          judullaporan: judullaporan ?? 'Laporan User',
          usercetak: username,
          tglcetak,
          judul: 'PT.TRANSPORINDO AGUNG SEJAHTERA',
        }));
      },
    });
  }

  /**
   * POST /user/export
   *
   * Export Excel di background. Request langsung balas { jobId }; progresnya
   * dikirim lewat socket namespace `/report` (kanal yang sama dengan cetak
   * laporan), dan file-nya diambil di GET /report/download/:jobId.
   *
   * Barisnya di-stream lewat cursor, bukan ditampung di array — export bisa
   * menyentuh ratusan ribu baris.
   */
  @UseGuards(AuthGuard)
  @Post('export')
  async exportBackground(
    @Body(new ZodValidationPipe(ExportUserSchema))
    body: ExportUserDto,
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
        sortBy: sortBy || 'username',
        sortDirection: (sortDirection || 'asc') as 'asc' | 'desc',
      },
    };

    return this.exportJobService.start({
      filename: `laporan_user_${stamp}.xlsx`,
      countRows: () => this.userService.countExportRows(queryParams, dbMssql),
      streamRows: () =>
        this.userService.buildExportQuery(queryParams, dbMssql).stream(),
      sheet: this.userService.exportSheet,
    });
  }

  @Get(':id')
  //@USER
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
}
