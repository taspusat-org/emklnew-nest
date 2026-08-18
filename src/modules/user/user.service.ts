import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { dbMssql } from 'src/common/utils/db';
import { RedisService } from 'src/common/redis/redis.service';
import {
  calculateItemIndex,
  getFetchedPages,
  UtilsService,
  uuidV7,
  withUuidV7,
} from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { LocksService } from '../locks/locks.service';
import { GlobalService } from '../global/global.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { Workbook, Column } from 'exceljs';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly tableName = 'users';
  private readonly DEFAULT_PASSWORD = '12345678';

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
    private readonly globalService: GlobalService,
    private readonly locksService: LocksService,
  ) {}

  private baseQuery(trx: any) {
    return trx(`${this.tableName} as u`).leftJoin(
      'parameter as p',
      'u.statusaktif',
      'p.id',
    );
  }

  private selectColumns(trx: any) {
    return [
      'u.id as id',
      'u.username',
      'u.name',
      'u.email',
      'u.statusaktif',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'p.memo',
      'p.text',
    ];
  }

  private readonly JOINED_COLUMNS: Record<string, string> = {
    text: 'p.text',
    memo: 'p.memo',
  };

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // statusaktif dikirim sebagai id parameter (varchar UUID) oleh FilterOptions,
    // jadi percuma ikut dicari pada search global yang berisi teks.
    const excludeSearchKeys = ['statusaktif', 'text', 'icon'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = ['created_at', 'updated_at'];

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else {
            const column = this.JOINED_COLUMNS[field] ?? `u.${field}`;
            query.orWhere(column, 'ilike', `%${sanitizedValue}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'text' || key === 'memo') {
        qb.andWhere(`p.${key}`, '=', sanitizedValue);
      } else {
        const column = this.JOINED_COLUMNS[key] ?? `u.${key}`;
        qb.andWhere(column, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id,
      username: dto.username ? String(dto.username).trim() : null,
      name: dto.name ? String(dto.name).toUpperCase() : null,
      email: dto.email ?? null,
      statusaktif: dto.statusaktif,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
      case 'text':
        return { orderCol: 'p.text', dir };
      default:
        return { orderCol: `u.${sortBy}`, dir };
    }
  }

  private async resolvePosition(
    trx: any,
    id: string,
    filters: Record<string, any>,
    search: string | undefined,
    sortBy: string,
    sortDirection: string,
  ): Promise<number> {
    const { orderCol, dir } = this.resolvePositionOrder(sortBy, sortDirection);

    const existingData = await this.baseQuery(trx)
      .select({ posval: orderCol })
      .where('u.id', id)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();

    // Baris tidak lolos filter aktif (mis. habis diedit jadi tidak cocok) ->
    // jatuhkan fokus ke baris pertama daripada menghitung posisi yang salah.
    if (!existingData || existingData.posval === null) return 1;

    const resultposition = await this.baseQuery(trx)
      .count('* as posisi')
      .where(orderCol, dir === 'desc' ? '>=' : '<=', existingData.posval)
      .modify((qb) => this.applyFilters(qb, filters, search))
      .first();

    const posisi = Number(resultposition?.posisi ?? 0);
    return posisi > 0 ? posisi : 1;
  }

  private async buildPagedResult(
    trx: any,
    posisi: number,
    totalItems: number,
    limit: number,
    sortBy: string,
    sortDirection: string,
    filters: Record<string, any>,
    search: string | undefined,
  ) {
    const pageNumber = Math.ceil(posisi / limit);
    const totalPages = Math.ceil(totalItems / limit);
    const fetchedPages = getFetchedPages(pageNumber, totalPages);

    const startPage = fetchedPages[0];
    const endPage = fetchedPages[fetchedPages.length - 1];
    const customOffset = (startPage - 1) * limit;
    const totalDataNeeded = (endPage - startPage + 1) * limit;

    const result = await this.findAll(
      {
        search: search || '',
        filters: filters || {},
        pagination: { page: startPage, limit: totalDataNeeded, customOffset },
        sort: { sortBy, sortDirection: sortDirection as 'asc' | 'desc' },
        isLookUp: false,
        useCustomOffset: true,
      },
      trx,
    );

    const allFetchedData = result?.data ?? [];
    const pagedData: Record<number, any[]> = {};
    let dataIndex = 0;
    fetchedPages.forEach((pageNum) => {
      pagedData[pageNum] = allFetchedData.slice(dataIndex, dataIndex + limit);
      dataIndex += limit;
    });

    const itemIndex = calculateItemIndex(Number(posisi), fetchedPages, limit);

    await this.redisService.set(
      `${this.tableName}-page-${pageNumber}`,
      JSON.stringify(allFetchedData),
    );

    return {
      itemIndex: itemIndex.zeroBasedIndex < 0 ? 0 : itemIndex.zeroBasedIndex,
      pageNumber,
      fetchedPages,
      pagedData,
    };
  }

  private async copyAccessFromUser(
    trx: any,
    targetUserId: string,
    sourceUserId: string,
    modifiedby: string,
  ): Promise<string> {
    const userAccess = await this.utilsService.fetchUserRolesAndUserAcl(
      sourceUserId,
      trx,
    );

    const abilityIds = userAccess.abilities.map((ability) => ability.id);
    const existingUserAclRecords = abilityIds.length
      ? await trx('useracl')
          .where('user_id', targetUserId)
          .whereIn('aco_id', abilityIds)
          .select('aco_id')
      : [];
    const existingAcoIds = new Set(
      existingUserAclRecords.map((record) => record.aco_id),
    );
    const newUserAclData = userAccess.abilities
      .filter((ability) => !existingAcoIds.has(ability.id))
      .map((ability) => ({
        user_id: targetUserId,
        aco_id: ability.id,
        modifiedby,
        created_at: this.utilsService.getTime(),
        updated_at: this.utilsService.getTime(),
      }));

    if (newUserAclData.length > 0) {
      await trx('useracl').insert(await withUuidV7(trx, newUserAclData));
    }

    for (const roleId of userAccess.roles) {
      const existingRole = await trx('userrole')
        .where('user_id', targetUserId)
        .andWhere('role_id', roleId)
        .first();

      if (existingRole) {
        await trx('userrole')
          .where('user_id', targetUserId)
          .andWhere('role_id', roleId)
          .update({
            modifiedby,
            updated_at: this.utilsService.getTime(),
          });
      } else {
        await trx('userrole').insert({
          id: await uuidV7(trx),
          user_id: targetUserId,
          role_id: roleId,
          modifiedby,
          created_at: this.utilsService.getTime(),
          updated_at: this.utilsService.getTime(),
        });
      }
    }

    const { abilities } = await this.utilsService.fetchUserRolesAndAbilities(
      targetUserId,
      trx,
    );
    const menuData = await this.utilsService.getDataMenuSidebar(trx);

    return this.utilsService.buildMenuString(menuData, abilities);
  }

  async create(CreateUserDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, limit, userId } =
        CreateUserDto;

      const sortColumn = sortBy || 'username';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const uuid = await uuidV7(trx);
      const insertData = this.buildInsertData(CreateUserDto, uuid);
      insertData.password = await bcrypt.hash(this.DEFAULT_PASSWORD, 10);

      await trx(this.tableName).insert(insertData);

      // Hak akses disalin SETELAH baris user ada (useracl/userrole punya FK ke
      // users.id), lalu menu-nya ditulis balik ke baris yang sama.
      if (userId) {
        const menuString = await this.copyAccessFromUser(
          trx,
          uuid,
          userId,
          CreateUserDto.modifiedby,
        );
        await trx(this.tableName)
          .where('id', uuid)
          .update({ menu: menuString });
      }

      // id berupa varchar UUID (bukan auto-increment), jadi orderBy('id','desc')
      // TIDAK mengembalikan baris yang baru diinsert. Ambil langsung by uuid
      // yang barusan digenerate supaya fokus baris setelah simpan tepat.
      const newItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', uuid)
        .first();

      // totalItems SELALU dihitung dengan filter yang sama seperti grid.
      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        uuid,
        filters,
        search,
        sortColumn,
        sortDir,
      );

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortColumn,
        sortDir,
        filters,
        search,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'ADD USER',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      return { newItem, ...paged };
    } catch (error) {
      throw new Error(`Error creating User : ${error.message}`);
    }
  }

  async findAll(
    {
      search,
      filters,
      pagination,
      sort,
      isLookUp,
      useCustomOffset,
    }: FindAllParams,
    trx: any,
  ) {
    try {
      const { page = 1, customOffset } = pagination ?? {};
      let limit = pagination?.limit ?? 0;

      const sortBy = sort?.sortBy || 'username';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
      const safeFilters = filters || {};

      // Count HARUS memakai filter & search yang sama dengan query data —
      // memakai COUNT tanpa filter (implementasi lama) membuat totalPages dan
      // posisi baris ikut salah begitu ada filter kolom / search aktif.
      const countResult = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      if (isLookUp) {
        // Hasil lookup > 500 baris: jangan tarik semuanya, biarkan komponen
        // LookUp beralih ke pencarian server-side.
        if (total > 500) {
          return {
            data: [],
            type: 'json',
            total,
            pagination: {
              currentPage: 1,
              totalPages: 0,
              totalItems: total,
              itemsPerPage: 0,
            },
          };
        }
        limit = 0; // <= 500: kirim seluruh baris, difilter di client.
      }

      const query = this.baseQuery(trx).select(this.selectColumns(trx));
      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);
      query.orderBy(orderCol, sortDirection);

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;
      const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
      const responseType = total > 500 ? 'json' : 'local';

      return {
        data,
        type: responseType,
        total,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
        },
      };
    } catch (error) {
      this.logger.error('Error fetching user data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch data');
    }
  }

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);

      const query = this.baseQuery(dbMssql)
        .select(this.selectColumns(dbMssql))
        .whereIn('u.id', idList)
        .orderBy('u.username', 'ASC');

      const data = await query;

      return data;
    } catch (error) {
      console.error('Error fetching data:', error);
      throw new Error('Failed to fetch data');
    }
  }

  async getById(id: string, trx: any) {
    try {
      const result = await trx(this.tableName).where('id', id).first();

      if (!result) {
        throw new Error('Data not found');
      }

      return result;
    } catch (error) {
      console.error('Error fetching data by id:', error);
      throw new Error('Failed to fetch data by id');
    }
  }

  async update(id: string, data: any, trx: any) {
    try {
      const existedData = await trx(this.tableName).where('id', id).first();

      if (!existedData) {
        throw new Error('User not found');
      }

      const { sortBy, sortDirection, filters, search, limit, userId } = data;

      const sortColumn = sortBy || 'username';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const insertData = this.buildInsertData(data);
      // id = kunci WHERE (PK), bukan kolom yang di-SET. created_at juga jangan
      // ditimpa saat edit (buildInsertData mengisinya dengan now() bila kosong).
      delete insertData.id;
      delete insertData.created_at;

      // Hak akses disalin lebih dulu supaya string menu hasilnya ikut tersimpan
      // dalam satu UPDATE yang sama.
      if (userId) {
        insertData.menu = await this.copyAccessFromUser(
          trx,
          id,
          userId,
          data.modifiedby,
        );
      }

      const hasChanges = this.utilsService.hasChanges(insertData, existedData);

      if (hasChanges) {
        insertData.updated_at = this.utilsService.getTime();
        await trx(this.tableName).where('id', id).update(insertData);
      }

      // Ambil baris yang SUDAH diperbarui (tanpa filter) supaya selalu ketemu
      // walau hasil edit tak lagi cocok dengan filter aktif.
      const updatedItem = await this.baseQuery(trx)
        .select(this.selectColumns(trx))
        .where('u.id', id)
        .first();

      const totalRecords = await this.baseQuery(trx)
        .count('u.id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      const totalItems = Number(totalRecords?.total ?? 0);

      const posisi = await this.resolvePosition(
        trx,
        id,
        filters,
        search,
        sortColumn,
        sortDir,
      );

      const paged = await this.buildPagedResult(
        trx,
        posisi,
        totalItems,
        pageLimit,
        sortColumn,
        sortDir,
        filters,
        search,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'EDIT USER',
          idtrans: updatedItem.id,
          nobuktitrans: updatedItem.id,
          aksi: 'EDIT',
          datajson: JSON.stringify(updatedItem),
          modifiedby: updatedItem.modifiedby,
        },
        trx,
      );

      return { updatedItem, ...paged };
    } catch (error) {
      console.error('Error updating User :', error);
      throw new Error('Failed to update User');
    }
  }

  async delete(id: string, trx: any, modifiedby: string) {
    try {
      const deletedData = await this.utilsService.lockAndDestroy(
        id,
        this.tableName,
        'id',
        trx,
      );

      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE USER',
          idtrans: deletedData.id,
          nobuktitrans: deletedData.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedData),
          modifiedby: modifiedby,
        },
        trx,
      );

      return { status: 200, message: 'Data deleted successfully', deletedData };
    } catch (error) {
      console.error('Error deleting data:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }

  private readonly EXPORT_COLUMNS = [
    'u.username',
    'u.name',
    'u.email',
    'p.text',
  ];

  buildExportQuery(
    {
      search,
      filters,
      sort,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    db: any,
  ) {
    const sortBy = sort?.sortBy || 'username';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);

    return this.baseQuery(db)
      .select(this.EXPORT_COLUMNS)
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .orderBy(orderCol, sortDirection);
  }

  async countExportRows(
    { search, filters }: Pick<FindAllParams, 'search' | 'filters'>,
    db: any,
  ): Promise<number> {
    const result = await this.baseQuery(db)
      .count('u.id as total')
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .first();

    return Number(result?.total ?? 0);
  }

  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN USER',
      'Data Export',
    ],
    headers: [
      'NO.',
      'USERNAME',
      'NAMA',
      'EMAIL',
      'NAMA KARYAWAN',
      'STATUS AKTIF',
    ],
    columnWidths: [5, 25, 30, 30, 30, 20],
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.username,
      row.name,
      row.email,
      row.namakaryawan,
      row.text,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN USER';
    worksheet.getCell('A3').value = 'Data Export';
    ['A1', 'A2', 'A3'].forEach((cellKey, i) => {
      worksheet.getCell(cellKey).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      worksheet.getCell(cellKey).font = {
        name: 'Tahoma',
        size: i === 0 ? 14 : 10,
        bold: true,
      };
    });

    const headers = this.exportSheet.headers;

    headers.forEach((header, index) => {
      const cell = worksheet.getCell(5, index + 1);
      cell.value = header;
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF00' },
      };
      cell.font = { bold: true, name: 'Tahoma', size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    data.forEach((row, rowIndex) => {
      const currentRow = rowIndex + 6;
      const rowValues = this.exportSheet.mapRow(row, rowIndex + 1);
      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        cell.alignment = {
          horizontal: colIndex === 0 ? 'right' : 'left',
          vertical: 'middle',
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    });

    worksheet.columns
      .filter((c): c is Column => !!c)
      .forEach((col) => {
        let maxLength = 0;
        col.eachCell({ includeEmpty: true }, (cell) => {
          const cellValue = cell.value ? cell.value.toString() : '';
          maxLength = Math.max(maxLength, cellValue.length);
        });
        col.width = maxLength + 2;
      });

    worksheet.getColumn(1).width = 6;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_user_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }

  async checkValidasi(aksi: string, value: any, editedby: any, trx: any) {
    try {
      if (aksi === 'EDIT') {
        const forceEdit = await this.locksService.forceEdit(
          this.tableName,
          value,
          editedby,
          trx,
        );

        return forceEdit;
      } else if (aksi === 'DELETE') {
        const validasi = await this.globalService.checkUsed(
          'userrole',
          'user_id',
          value,
          trx,
        );

        return validasi;
      }
    } catch (error) {
      console.error('Error di checkValidasi:', error);
      throw new InternalServerErrorException('Failed to check validation');
    }
  }
}
