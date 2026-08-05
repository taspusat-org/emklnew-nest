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
} from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import * as fs from 'fs';
import * as path from 'path';
import { Workbook } from 'exceljs';
@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);
  private readonly tableName = 'menus';
  constructor(
    @Inject('REDIS_CLIENT') private readonly redisService: RedisService,
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}

  /**
   * Tabel `menus` tidak punya view turunan seperti `valatbayar`, jadi kolom
   * teks status (p.text), nama aco (a.nama), dan judul parent (parent.title)
   * diambil lewat LEFT JOIN. Query dasar ini dipakai findAll, COUNT, dan
   * perhitungan posisi baris supaya ketiganya melihat dataset yang PERSIS sama.
   */
  private baseQuery(trx: any) {
    return trx(`${this.tableName} as u`)
      .leftJoin(`${this.tableName} as parent`, 'u.parentid', 'parent.id')
      .leftJoin('parameter as p', 'u.statusaktif', 'p.id')
      .leftJoin('acos as a', 'u.aco_id', 'a.id');
  }

  private selectColumns(trx: any) {
    return [
      'u.id as id',
      'u.title',
      'u.aco_id',
      'u.icon',
      // Kolom fisiknya `parentid` & `isactive` (Postgres melipat identifier
      // tanpa kutip jadi huruf kecil). Di-alias ke camelCase supaya kontrak
      // JSON ke frontend tidak berubah.
      'u.parentid as parentId',
      'u.isactive as isActive',
      'u.order',
      'u.statusaktif',
      'u.modifiedby',
      trx.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      trx.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
      'p.memo',
      'p.text',
      'a.nama as acos_nama',
      'parent.title as parent_nama',
    ];
  }

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    // statusaktif dikirim sebagai id parameter (varchar UUID) oleh FilterOptions,
    // jadi percuma ikut dicari pada search global yang berisi teks.
    const excludeSearchKeys = ['statusaktif', 'text', 'memo'];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = ['created_at', 'updated_at'];
    // `order` bertipe integer: Postgres tidak punya operator `integer ILIKE
    // text`, jadi harus di-CAST dulu sebelum dicocokkan sebagai teks.
    const numericFields = ['order'];

    // Kolom turunan dari JOIN -> harus dicocokkan ke kolom tabel asalnya,
    // bukan ke `u.<key>` yang tidak ada.
    const joinedFields: Record<string, string> = {
      parent_nama: 'parent.title',
      parentId: 'parent.title',
      parentid: 'parent.title',
      acos_nama: 'a.nama',
    };

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw("TO_CHAR(u.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (numericFields.includes(field)) {
            query.orWhereRaw('CAST(u.?? AS TEXT) ILIKE ?', [
              field,
              `%${sanitizedValue}%`,
            ]);
          } else if (joinedFields[field]) {
            query.orWhere(joinedFields[field], 'ilike', `%${sanitizedValue}%`);
          } else {
            query.orWhere(`u.${field}`, 'ilike', `%${sanitizedValue}%`);
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
      } else if (numericFields.includes(key)) {
        qb.andWhereRaw('CAST(u.?? AS TEXT) ILIKE ?', [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'text' || key === 'memo') {
        qb.andWhere(`p.${key}`, '=', sanitizedValue);
      } else if (joinedFields[key]) {
        qb.andWhere(joinedFields[key], 'ilike', `%${sanitizedValue}%`);
      } else {
        qb.andWhere(`u.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  /**
   * Payload insert/update dibangun EKSPLISIT dari kolom tabel supaya field
   * bantu dari frontend (sortBy, filters, parent_nama, acos_nama, dll) tidak
   * ikut ditulis -> "Invalid column name". Uppercase HANYA title & icon:
   * id, aco_id, parentId, dan statusaktif adalah uuid v7 HURUF KECIL —
   * meng-uppercase-nya menulis id yang tidak ada sehingga relasi parent/aco/
   * status tampil kosong dan perubahan terlihat "tidak tersimpan".
   */
  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid ? uuid : dto.id,
      title: dto.title ? dto.title.toUpperCase() : null,
      aco_id: dto.aco_id ?? null,
      icon: dto.icon ? dto.icon.toUpperCase() : null,
      // Nama kolom fisik huruf kecil. `isactive` bertipe BOOLEAN — frontend
      // mengirim angka 1/0, dan Postgres menolak integer untuk kolom boolean.
      isactive:
        dto.isActive === undefined || dto.isActive === null
          ? true
          : Boolean(dto.isActive),
      parentid: dto.parentId ?? null,
      order: dto.order ?? null,
      statusaktif: dto.statusaktif,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilsService.getTime(),
      updated_at: dto.updated_at || this.utilsService.getTime(),
    };
  }

  /**
   * Kolom + arah urut yang dipakai untuk menghitung posisi baris. WAJIB
   * mereplikasi orderBy di findAll(): grid mengurutkan kolom status memakai
   * TEKS parameter (p.text) dan kolom parent memakai parent.title, bukan id
   * UUID-nya. Kalau tidak sama, fokus baris setelah simpan akan meleset.
   */
  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { orderCol: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
      case 'text':
        return { orderCol: 'p.text', dir };
      case 'parent_nama':
      case 'parentId':
      case 'parentid':
        return { orderCol: 'parent.title', dir };
      case 'acos_nama':
        return { orderCol: 'a.nama', dir };
      default:
        return { orderCol: `u.${sortBy}`, dir };
    }
  }

  /**
   * Posisi (1-based) baris `id` pada dataset yang sedang tampil di grid:
   * jumlah baris yang urutannya <= (asc) / >= (desc) baris tersebut, dengan
   * filter + search yang sama. Nilai pembanding diambil MENTAH dari database
   * (lewat alias `posval`), bukan dari hasil select yang sudah di-TO_CHAR,
   * supaya sort kolom tanggal/angka dibandingkan sebagai tanggal/angka.
   */
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

  /**
   * Rakit window halaman di sekitar `posisi` lalu balikan datanya per halaman.
   * Satu kali findAll dengan customOffset, dipecah di memory — bukan menarik
   * SELURUH tabel lalu findIndex seperti implementasi lama.
   */
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

  async create(createMenuDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, limit } = createMenuDto;

      const sortColumn = sortBy || 'title';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const uuid = await uuidV7(trx);
      await trx(this.tableName).insert(
        this.buildInsertData(createMenuDto, uuid),
      );

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
          postingdari: 'ADD MENU',
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
      throw new Error(`Error creating menu: ${error.message}`);
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

      const sortBy = sort?.sortBy || 'title';
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
      this.logger.error('Error fetching menu data', error?.stack);
      throw new InternalServerErrorException('Failed to fetch data');
    }
  }

  async findAllByIds(ids: { id: string }[]) {
    try {
      const idList = ids.map((item) => item.id);

      const data = await this.baseQuery(dbMssql)
        .select(this.selectColumns(dbMssql))
        .whereIn('u.id', idList)
        .orderBy('u.title', 'asc');

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
        throw new Error('Menu not found');
      }

      const { sortBy, sortDirection, filters, search, limit } = data;

      const sortColumn = sortBy || 'title';
      const sortDir = sortDirection || 'asc';
      const pageLimit = Number(limit) > 0 ? Number(limit) : 10;

      const insertData = this.buildInsertData(data);
      // id = kunci WHERE (PK), bukan kolom yang di-SET. created_at juga jangan
      // ditimpa saat edit (buildInsertData mengisinya dengan now() bila kosong).
      delete insertData.id;
      delete insertData.created_at;

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
          postingdari: 'EDIT MENU',
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
      console.error('Error updating menu:', error);
      throw new Error('Failed to update menu');
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
          postingdari: 'DELETE MENU',
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

  sortMenuData(menuData) {
    const mapChildren = (menu) => {
      if (menu.items && menu.items.length > 0) {
        menu.items = menu.items
          .sort((a, b) => a.order - b.order)
          .map(mapChildren);
      }
      return menu;
    };

    return menuData.sort((a, b) => a.order - b.order).map(mapChildren);
  }

  async updateMenuResequence(data, parentId = 0, order = 0, trx) {
    if (!Array.isArray(data)) {
      throw new Error("Expected 'data' to be an array.");
    }

    for (const [index, item] of data.entries()) {
      const { id, text, icon, children } = item;

      // Check if item exists in the database
      const existingItem = await trx('menus').where({ id }).first();

      if (existingItem) {
        // Update the existing menu item. Kolom fisiknya `parentid` (huruf
        // kecil) — memakai `parentId` membuat Postgres menolak query.
        await trx('menus')
          .where({ id })
          .update({
            title: text,
            icon: icon || null,
            parentid: parentId,
            order: order + index + 1,
            updated_at: new Date(),
          });
      } else {
        // Insert new menu item
        await trx('menus').insert({
          id,
          title: text,
          icon: icon || null,
          parentid: parentId,
          order: order + index + 1,
          updated_at: new Date(),
        });
      }

      // Recursively update children menus if any
      if (Array.isArray(children) && children.length > 0) {
        await this.updateMenuResequence(children, id, order + index + 1, trx);
      }
    }

    // After updating the menus, update the users' menu strings
    const users = await trx('users').select('id');

    for (const user of users) {
      const { abilities } = await this.utilsService.fetchUserRolesAndAbilities(
        user.id,
        trx,
      );

      const menuData = await this.utilsService.getDataMenuSidebar(trx);
      const sortedMenuData = this.sortMenuData(menuData);
      const menuString = this.utilsService.buildMenuString(
        sortedMenuData,
        abilities,
      );

      await trx('users').where({ id: user.id }).update({
        menu: menuString,
        updated_at: new Date(),
      });
    }
  }

  async getMenuSidebar(userId: number) {
    try {
      const user = await dbMssql('users')
        .select('menu')
        .where('id', userId)
        .first();

      if (!user) {
        throw new Error(`User dengan ID ${userId} tidak ditemukan`);
      }

      const menuField = user.menu;
      if (!menuField) {
        throw new Error(`Field menu kosong untuk user ID ${userId}`);
      }

      return menuField;
    } catch (error) {
      console.error('Error fetching user menu sidebar:', error);
      throw new Error('Gagal mengambil data menu sidebar user');
    }
  }

  // Build breadcrumb string from parentId chain, e.g. "system -> user"
  async buildParentBreadcrumb(parentId: number) {
    try {
      if (!parentId) return '';

      const titles: string[] = [];
      let currentId = parentId;

      while (currentId && currentId !== 0) {
        const row = await dbMssql('menus')
          .select('title', 'parentid as parentId')
          .where('id', currentId)
          .first();

        if (!row) break;

        // accumulate title
        titles.push(row.title);

        // walk up
        if (!row.parentId || row.parentId === 0) break;
        currentId = row.parentId;
      }

      // reverse so top-most parent is first
      return titles.reverse().join(' -> ');
    } catch (error) {
      console.error('Error building parent breadcrumb:', error);
      return '';
    }
  }
  async getSearchMenu(userId: number, search: string = '') {
    try {
      const userAcls = await dbMssql('useracl')
        .select('aco_id')
        .where('user_id', userId);

      const userRoles = await dbMssql('userrole')
        .select('role_id')
        .where('user_id', userId);

      const roleIds = userRoles.map((role) => role.role_id);

      const roleAcls = await dbMssql('acl')
        .select('aco_id')
        .whereIn('role_id', roleIds);

      const userAcoIds = new Set([
        ...userAcls.map((acl) => acl.aco_id),
        ...roleAcls.map((acl) => acl.aco_id),
      ]);

      let query = dbMssql('menus')
        .select(
          'menus.id as id',
          'title',
          'icon',
          'menus.parentid as parentId',
          'order',
          'a.class as url',
        )
        .leftJoin('acos as a', 'menus.aco_id', 'a.id')
        .whereIn('aco_id', Array.from(userAcoIds))
        .orderBy('parentid')
        .orderBy('order');

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]');
        query = query.andWhere('title', 'ilike', `%${sanitizedValue}%`);
      }

      const menus = await query;

      if (!menus.length) {
        throw new Error(`No menus found for user ID ${userId}`);
      }

      const menusWithBreadcrumb = await Promise.all(
        menus.map(async (m) => {
          const parentBreadcrumb = m.parentId
            ? await this.buildParentBreadcrumb(m.parentId)
            : '';
          return {
            ...m,
            parentBreadcrumb,
          };
        }),
      );

      return menusWithBreadcrumb;
    } catch (error) {
      console.error('Error fetching user menu sidebar:', error);
      throw new Error('Gagal mengambil data menu sidebar user');
    }
  }

  /** Kolom yang benar-benar dipakai file export — bukan seluruh kolom grid. */
  private exportColumns(db: any) {
    return [
      'u.title',
      'parent.title as parent_nama',
      'u.icon',
      'a.nama as acos_nama',
      'u.order',
      'p.text',
      db.raw("TO_CHAR(u.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
      db.raw("TO_CHAR(u.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
    ];
  }

  /**
   * Query dasar export: filter & sort yang sama dengan findAll, TANPA paging
   * dan hanya kolom yang dipakai file Excel.
   *
   * Dipisah supaya export bisa di-stream lewat cursor (`.stream()`) — menarik
   * seluruh baris ke sebuah array lebih dulu adalah yang membuat proses
   * kehabisan heap saat datanya banyak.
   */
  buildExportQuery(
    {
      search,
      filters,
      sort,
    }: Pick<FindAllParams, 'search' | 'filters' | 'sort'>,
    db: any,
  ) {
    const sortBy = sort?.sortBy || 'title';
    const sortDirection =
      sort?.sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';

    const { orderCol } = this.resolvePositionOrder(sortBy, sortDirection);

    return this.baseQuery(db)
      .select(this.exportColumns(db))
      .modify((qb: any) => this.applyFilters(qb, filters || {}, search))
      .orderBy(orderCol, sortDirection);
  }

  /**
   * Jumlah baris yang akan diekspor — dipakai untuk progres export yang
   * sebenarnya. JOIN-nya tetap dipakai karena filter menyaring lewat kolom
   * turunan (p.text, parent.title, a.nama).
   */
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

  /** Definisi sheet export — dipakai jalur background (streaming). */
  readonly exportSheet = {
    sheetName: 'Data Export',
    titleLines: [
      'PT. TRANSPORINDO AGUNG SEJAHTERA',
      'LAPORAN MENU',
      'Data Export',
    ],
    headers: [
      'NO.',
      'MENU NAME',
      'MENU PARENT',
      'MENU ICON',
      'ACO',
      'ORDER',
      'STATUS AKTIF',
      'CREATED AT',
      'UPDATED AT',
    ],
    // Mode streaming tidak bisa auto-fit, jadi lebarnya ditetapkan di sini.
    mapRow: (row: any, rowNumber: number) => [
      rowNumber,
      row.title,
      row.parent_nama,
      row.icon,
      row.acos_nama,
      row.order,
      row.text,
      row.created_at,
      row.updated_at,
    ],
  };

  async exportToExcel(data: any[]) {
    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Data Export');

    worksheet.mergeCells('A1:I1');
    worksheet.mergeCells('A2:I2');
    worksheet.mergeCells('A3:I3');
    worksheet.getCell('A1').value = 'PT. TRANSPORINDO AGUNG SEJAHTERA';
    worksheet.getCell('A2').value = 'LAPORAN MENU';
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

    const headers = [
      'NO.',
      'MENU NAME',
      'MENU PARENT',
      'MENU ICON',
      'ACO',
      'ORDER',
      'STATUS AKTIF',
      'CREATED AT',
      'UPDATED AT',
    ];
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
      const rowValues = [
        rowIndex + 1,
        row.title,
        row.parent_nama,
        row.icon,
        row.acos_nama,
        row.order,
        row.text,
        row.created_at,
        row.updated_at,
      ];

      rowValues.forEach((value, colIndex) => {
        const cell = worksheet.getCell(currentRow, colIndex + 1);
        cell.value = value ?? '';
        cell.font = { name: 'Tahoma', size: 10 };
        cell.alignment = {
          horizontal: colIndex === 0 || colIndex === 5 ? 'right' : 'left',
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

    worksheet.getColumn(1).width = 10;
    worksheet.getColumn(2).width = 30;
    worksheet.getColumn(3).width = 30;
    worksheet.getColumn(4).width = 30;
    worksheet.getColumn(5).width = 20;
    worksheet.getColumn(6).width = 10;
    worksheet.getColumn(7).width = 15;
    worksheet.getColumn(8).width = 25;
    worksheet.getColumn(9).width = 25;

    const tempDir = path.resolve(process.cwd(), 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFilePath = path.resolve(
      tempDir,
      `laporan_menu${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(tempFilePath);

    return tempFilePath;
  }

  async getMenuResequence() {
    const menus = await dbMssql('menus')
      .select('*')
      .orderBy(['parentid', 'order']);

    const itemsMap = new Map<any, any>();
    const rootItems: any[] = [];

    menus.forEach((item) => {
      const menuItem = {
        id: item.id,
        text: item.title,
        order: item.order,
        ...(item.icon ? { icon: item.icon } : {}),
        children: [],
      };

      itemsMap.set(item.id, menuItem);

      // Root ditandai parentid kosong/0 — kolomnya varchar sehingga nilainya
      // bisa berupa string '0' maupun null.
      const parentId = item.parentid;
      if (!parentId || parentId === 0 || parentId === '0') {
        rootItems.push(menuItem);
      } else {
        const parentItem = itemsMap.get(parentId);
        if (parentItem) {
          parentItem.children.push(menuItem);
        } else {
          itemsMap.set(parentId, { children: [menuItem] });
        }
      }
    });

    const sortItems = (items: any[]): any[] => {
      return items
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          ...item,
          children: sortItems(item.children),
        }));
    };

    return sortItems(rootItems);
  }
  async getDataMenuSidebar(userId: number) {
    try {
      // Fetch all ACLs and roles associated with the user
      const userAcls = await dbMssql('useracl')
        .select('aco_id')
        .where('user_id', userId);

      const userRoles = await dbMssql('userrole')
        .select('role_id')
        .where('user_id', userId);

      const roleIds = userRoles.map((role) => role.role_id);

      const roleAcls = await dbMssql('acl')
        .select('aco_id')
        .whereIn('role_id', roleIds);

      // Combine aco_ids from userAcls and roleAcls
      const userAcoIds = new Set([
        ...userAcls.map((acl) => acl.aco_id),
        ...roleAcls.map((acl) => acl.aco_id),
      ]);

      // Fetch menus associated with the user ACOs
      const query = dbMssql('menus')
        .select('id', 'title', 'icon', 'parentid as parentId', 'order')
        .whereIn('aco_id', Array.from(userAcoIds))
        .orderBy('parentid')
        .orderBy('order');

      const menus = await query;

      if (!menus.length) {
        throw new Error(`No menus found for user ID ${userId}`);
      }

      return menus;
    } catch (error) {
      console.error('Error fetching user menu sidebar:', error);
      throw new Error('Gagal mengambil data menu sidebar user');
    }
  }
}
