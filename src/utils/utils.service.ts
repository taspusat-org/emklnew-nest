import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { Menu, UserRoleAbilities } from 'src/common/interfaces/all.interface';
import { Users } from 'src/common/interfaces/users.interface';
import { dbMssql } from 'src/common/utils/db';
import sharp, { FormatEnum } from 'sharp';
import multer from 'multer';
import path from 'path';
import * as fs from 'fs';
// import { v4, v7 } from 'uuid';
import { uuidv7 } from 'uuidv7';
const mimeToSharpFormat: { [key: string]: keyof FormatEnum } = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
@Injectable()
export class UtilsService {
  async createTempTable(
    tableName: string,
    trx: any,
    tempError: string,
  ): Promise<string> {
    try {
      // Postgres: buat TEMP TABLE yang meniru KOLOM+TIPE tabel asli lewat
      // `CREATE TABLE AS SELECT * ... WHERE 1=0`. Sengaja TIDAK pakai `LIKE`
      // karena LIKE selalu menyalin NOT NULL — sedangkan temp ini dipakai
      // sebagai scratch untuk baris parsial (mis. kolom id/created_at belum
      // terisi), jadi kolomnya harus nullable. `AS SELECT ... WHERE 1=0`
      // menyalin nama & tipe kolom tanpa constraint/default. Temp hidup di
      // pg_temp sepanjang transaksi dan otomatis dibersihkan.
      //
      // Nama temp dinormalisasi: buang prefiks '#'/'##' (global temp ala MSSQL)
      // karena '#' bukan identifier valid di PG saat direferensikan mentah
      // (mis. `trx.raw(`${temp}.kolom`)`).
      const temp = String(tempError).replace(/^#+/, '');

      const createTableQuery = `CREATE TEMP TABLE "${temp}" AS SELECT * FROM ${tableName} WHERE 1=0`;

      return createTableQuery;
    } catch (error) {
      console.error('Error creating temporary table:', error);
      throw error;
    }
  }

  /**
   * Create temporary table from data array (auto-detect structure)
   * OPTIMIZED FOR BIG DATA - Support jutaan records dengan bulk insert
   *
   * @param data Array of objects to insert
   * @param trx Transaction object
   * @param customPrefix Optional custom prefix for temp table name
   * @param options Optional configuration
   *   - chunkSize: Number of rows per batch (default: 5000 for big data)
   *   - addPositionField: Add auto-increment position field (default: true)
   *   - onProgress: Callback for progress tracking
   * @returns Object containing temp table name, inserted count, and execution time
   */
  async createTempTableFromData(
    data: any[],
    trx: any,
    customPrefix?: string,
  ): Promise<{
    tempTableName: string;
    insertedCount: number;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();

    try {
      // Postgres tidak mengenal prefix `##` (itu global temp table SQL Server)
      // maupun IDENTITY(1,1) — pakai CREATE TEMP TABLE + GENERATED AS IDENTITY.
      const tempTableName = `temp_${customPrefix || 'data'}_${Math.random().toString(36).substring(2, 15)}`;

      // ON COMMIT DROP: helper ini selalu dipanggil di dalam transaksi knex,
      // jadi tabelnya ikut hilang saat commit/rollback. Tanpa itu temp table PG
      // hidup selama SESSION (bukan query) dan menumpuk di koneksi pool.
      const createTempTable = async (defs: string[]) => {
        await trx.raw(
          `CREATE TEMP TABLE "${tempTableName}" (\n  ${defs.join(',\n  ')}\n) ON COMMIT DROP`,
        );
      };

      // Handle empty data - create empty table with position field only
      if (!data || data.length === 0) {
        await createTempTable(['position BIGINT GENERATED ALWAYS AS IDENTITY']);

        return {
          tempTableName,
          insertedCount: 0,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Configuration
      const chunkSize = data.length > 100000 ? 5000 : 1000;

      // Get column definitions from first data object
      const firstRow = data[0];
      const columns = Object.keys(firstRow);

      // Semua kolom data dibuat `text`. Tabel ini cuma dipakai untuk mencari
      // `position` sebuah baris (lihat akunpusat.service), nilainya tak pernah
      // dihitung secara numerik — menebak tipe dari baris pertama justru bikin
      // insert gagal begitu baris lain bertipe lain atau baris pertama null.
      await createTempTable([
        'position BIGINT GENERATED ALWAYS AS IDENTITY',
        ...columns.map((columnName) => `"${columnName}" text NULL`),
      ]);

      // Bulk insert lewat query builder knex: bindings otomatis ter-escape dan
      // dikutip sesuai dialek. Versi lama merangkai sendiri literal `N'...'`
      // ala T-SQL, yang selain salah dialek juga rawan saat data berisi kutip.
      let insertedCount = 0;

      const toText = (value: any): string | null => {
        if (value === null || value === undefined) return null;
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      };

      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize).map((row) => {
          const normalized: Record<string, string | null> = {};
          columns.forEach((col) => {
            normalized[col] = toText(row[col]);
          });
          return normalized;
        });

        await trx(tempTableName).insert(chunk);
        insertedCount += chunk.length;
      }

      const executionTimeMs = Date.now() - startTime;

      // Log performance metrics for big data
      if (data.length > 10000) {
        console.log(`[TEMP TABLE] Created ${tempTableName}`);
        console.log(
          `[TEMP TABLE] Inserted ${insertedCount} rows in ${executionTimeMs}ms`,
        );
        console.log(
          `[TEMP TABLE] Speed: ${Math.round(insertedCount / (executionTimeMs / 1000))} rows/sec`,
        );
      }

      return {
        tempTableName,
        insertedCount,
        executionTimeMs,
      };
    } catch (error) {
      console.error('Error creating temp table from data:', error);
      throw new Error(`Failed to create temp table: ${error.message}`);
    }
  }
  /**
   * Create temp table directly from SQL query using SELECT INTO (optimized for BIG DATA)
   * This method is MUCH FASTER than fetching to Node.js then inserting
   * Perfect for 500k+ rows
   */
  async createTempFisikTableFromQuery(
    queryBuilder: any,
    trx: any,
    customPrefix?: string,
  ): Promise<{
    tempFisikTableFromData: string;
    insertedCount: number;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();

    try {
      const tempFisikTableFromData = `temp_${customPrefix || 'data'}_${Math.random().toString(36).substring(2, 15)}`;

      // Drop table if exists
      await trx.raw(
        `IF OBJECT_ID('${tempFisikTableFromData}', 'U') IS NOT NULL DROP TABLE ${tempFisikTableFromData}`,
      );

      // Get the SQL string from query builder
      let sqlQuery = queryBuilder.toString();

      // Remove ORDER BY clause from the query
      sqlQuery = sqlQuery.replace(
        /ORDER\s+BY\s+[\s\S]+?(?=OFFSET|FETCH|$)/gi,
        '',
      );

      // Create temp table with ROW_NUMBER as position directly in the SELECT INTO
      // This converts any IDENTITY columns to regular columns
      // Jika ingin menggunakan urutan dari query builder
      const selectIntoSQL = `
  SELECT 
    ROW_NUMBER() OVER (ORDER BY id) as position,  -- ganti 'id' dengan kolom sorting yang diinginkan
    *
  INTO ${tempFisikTableFromData}
  FROM (${sqlQuery}) AS source_data
`;

      await trx.raw(selectIntoSQL);

      // Get count
      const countResult = await trx.raw(
        `SELECT COUNT(*) as total FROM ${tempFisikTableFromData}`,
      );
      const insertedCount = countResult[0]?.total || 0;

      const executionTimeMs = Date.now() - startTime;

      console.log(`[TEMP TABLE] Created ${tempFisikTableFromData}`);
      console.log(
        `[TEMP TABLE] Inserted ${insertedCount} rows in ${executionTimeMs}ms using SELECT INTO`,
      );
      console.log(
        `[TEMP TABLE] Speed: ${Math.round(insertedCount / (executionTimeMs / 1000))} rows/sec`,
      );

      return {
        tempFisikTableFromData,
        insertedCount,
        executionTimeMs,
      };
    } catch (error) {
      console.error('Error creating temp table from query:', error);
      throw new Error(`Failed to create temp table: ${error.message}`);
    }
  }
  async createTempFisikTableFromData(
    data: any[],
    trx: any,
    customPrefix?: string,
  ): Promise<{
    tempFisikTableFromData: string;
    insertedCount: number;
    executionTimeMs: number;
  }> {
    const startTime = Date.now();

    try {
      // Generate unique temp table name
      const tempFisikTableFromData = `temp_${customPrefix || 'data'}_${Math.random().toString(36).substring(2, 15)}`;
      // Drop table if exists
      await trx.raw(
        `IF OBJECT_ID('${tempFisikTableFromData}', 'U') IS NOT NULL DROP TABLE ${tempFisikTableFromData}`,
      );
      // Handle empty data - create empty table with position field only
      if (!data || data.length === 0) {
        const createTableSQL = `
          CREATE TABLE ${tempFisikTableFromData} (
            position BIGINT IDENTITY(1,1) NOT NULL
          )
        `;
        await trx.raw(createTableSQL);

        return {
          tempFisikTableFromData,
          insertedCount: 0,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Configuration
      const chunkSize = data.length > 100000 ? 5000 : 1000;

      // Get column definitions from first data object
      const firstRow = data[0];
      const columns = Object.keys(firstRow);

      // Build column definitions for raw SQL
      const columnDefs: string[] = [];

      columnDefs.push('position BIGINT IDENTITY(1,1) NOT NULL');
      columns.forEach((columnName) => {
        const value = firstRow[columnName];
        const valueType = typeof value;

        let columnDef = '';

        if (valueType === 'number') {
          if (Number.isInteger(value)) {
            columnDef = `[${columnName}] BIGINT NULL`;
          } else {
            columnDef = `[${columnName}] DECIMAL(18,2) NULL`;
          }
        } else if (valueType === 'boolean') {
          columnDef = `[${columnName}] BIT NULL`;
        } else if (value instanceof Date) {
          columnDef = `[${columnName}] DATETIME2 NULL`;
        } else if (valueType === 'string') {
          const strLength = String(value).length;
          if (strLength > 500) {
            columnDef = `[${columnName}] text NULL`;
          } else {
            columnDef = `[${columnName}] NVARCHAR(255) NULL`;
          }
        } else {
          columnDef = `[${columnName}] NVARCHAR(255) NULL`;
        }

        columnDefs.push(columnDef);
      });

      // Create table using raw SQL (faster than schema builder)
      const createTableSQL = `
        CREATE TABLE ${tempFisikTableFromData} (
          ${columnDefs.join(',\n          ')}
        )
      `;
      await trx.raw(createTableSQL);

      // Bulk insert using raw SQL (much faster for big data)
      let insertedCount = 0;
      const totalChunks = Math.ceil(data.length / chunkSize);

      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);

        // Build VALUES clause for bulk insert
        const values = chunk
          .map((row) => {
            const rowValues = columns.map((col) => {
              const value = row[col];

              // Handle NULL
              if (value === null || value === undefined) {
                return 'NULL';
              }

              // Handle different types
              if (typeof value === 'number') {
                return value;
              } else if (typeof value === 'boolean') {
                return value ? '1' : '0';
              } else if (value instanceof Date) {
                return `'${value.toISOString().slice(0, 23)}'`;
              } else {
                // Escape single quotes in strings
                const escaped = String(value).replace(/'/g, "''");
                return `N'${escaped}'`;
              }
            });

            return `(${rowValues.join(',')})`;
          })
          .join(',\n');

        // Execute bulk insert
        const insertSQL = `
          INSERT INTO ${tempFisikTableFromData} (${columns.map((c) => `[${c}]`).join(',')})
          VALUES ${values}
        `;

        await trx.raw(insertSQL);
        insertedCount += chunk.length;
      }

      const executionTimeMs = Date.now() - startTime;

      // Log performance metrics for big data
      if (data.length > 10000) {
        console.log(`[TEMP TABLE] Created ${tempFisikTableFromData}`);
        console.log(
          `[TEMP TABLE] Inserted ${insertedCount} rows in ${executionTimeMs}ms`,
        );
        console.log(
          `[TEMP TABLE] Speed: ${Math.round(insertedCount / (executionTimeMs / 1000))} rows/sec`,
        );
      }

      return {
        tempFisikTableFromData,
        insertedCount,
        executionTimeMs,
      };
    } catch (error) {
      console.error('Error creating temp table from data:', error);
      throw new Error(`Failed to create temp table: ${error.message}`);
    }
  }

  // Versi PostgreSQL: dulu ditulis untuk MSSQL (PIVOT + tabel ##temp_*
  // "global temp table"). Di Postgres itu tidak jalan sama sekali — PIVOT/[col]
  // bukan sintaks valid, dan '##temp_*' bukan konvensi apa pun di Postgres
  // (knex akan membuat TABEL PERMANEN literal bernama itu, yang lalu tidak
  // pernah di-DROP di mana pun -> menumpuk setiap kali fungsi ini dipanggil,
  // sebelum akhirnya tetap gagal di step PIVOT-nya).
  //
  // Kategori (mis. 'tradoluar', 'pisahbl', ...) diambil dari `fieldTempHasil`
  // yang caller sendiri deklarasikan (bukan hasil discovery dinamis dari data
  // seperti versi lama) — supaya baris tetap dihasilkan (kolom kategori NULL)
  // walau sebuah transaksi belum punya satupun baris statuspendukung. Versi
  // lama melempar "No columns generated for PIVOT" pada kasus itu dan
  // mematahkan seluruh query header yang men-join hasil fungsi ini.
  //
  // "Rows -> columns" dikerjakan lewat conditional aggregation
  // (`FILTER (WHERE ...)`), bukan crosstab() dari extension tablefunc:
  // FILTER mencocokkan tiap kolom secara eksplisit by kategori, jadi tidak
  // berisiko kolom "tergeser" seperti crosstab() bila suatu kategori
  // kebetulan tidak punya baris untuk transaksi tertentu (crosstab
  // mencocokkan positional terhadap urutan kategori).
  //
  // Hasilnya DIMATERIALISASI ke satu TEMP TABLE Postgres asli (bukan tabel
  // ##temp_* permanen ala versi lama, dan bukan pula string subquery mentah —
  // knex meng-quote string pertama .leftJoin() sebagai SATU identifier, jadi
  // titik-titik di dalam SQL subquery mentah pecah jadi "improper qualified
  // name"). ON COMMIT DROP: otomatis lenyap saat transaksi commit/rollback,
  // tidak perlu DROP manual dan tidak menumpuk. Nama tabel dikembalikan apa
  // adanya (identifier biasa) sehingga kedua caller (orderan-muatan &
  // bookingorderanmuatan.service.ts) tetap memakainya persis seperti sebelum
  // — `` `${dataTempStatusPendukung} as pivot` `` di .leftJoin() — tanpa
  // perubahan apa pun di sana.
  async tempPivotStatusPendukung(
    trx: any,
    tablename: string,
    fieldTempHasil: any,
  ) {
    try {
      const categories: string[] = (fieldTempHasil as string[]).filter(
        (f) => !f.endsWith('_nama') && !f.endsWith('_memo'),
      );

      if (categories.length === 0) {
        throw new Error(
          `tempPivotStatusPendukung: fieldTempHasil untuk '${tablename}' tidak berisi kategori valid`,
        );
      }

      // Pola yang sama dengan statuspendukung.service.ts: parse memo sebagai
      // JSON hanya bila memang JSON valid.
      const memoJson = (col: string) =>
        `(CASE WHEN ${col} IS JSON THEN ${col}::jsonb END)`;

      // "judul" = label kategori yang dikonfigurasi lewat
      // parameter.memo->>'MEMO' pada baris statusdatapendukung. TOP/OPEN
      // historis diberi suffix _field (lihat versi MSSQL lama) — belum
      // dipakai oleh kedua caller saat ini, tapi dipertahankan untuk
      // caller lain yang mungkin memakai kategori tsb.
      const judulKeyExpr = `LOWER(REPLACE(
        CASE
          WHEN (${memoJson('c.memo')}->>'MEMO') IN ('TOP', 'OPEN')
            THEN (${memoJson('c.memo')}->>'MEMO') || '_FIELD'
          ELSE COALESCE(${memoJson('c.memo')}->>'MEMO', '')
        END,
        ' ', ''
      ))`;

      const categoryColumns = categories
        .map((category) => {
          const cat = String(category).toLowerCase().replace(/\s+/g, '');
          return `
            MAX(d.id::text) FILTER (WHERE ${judulKeyExpr} = '${cat}') AS ${category},
            MAX(${memoJson('d.memo')}->>'MEMO') FILTER (WHERE ${judulKeyExpr} = '${cat}') AS ${category}_nama,
            MAX(d.memo::text) FILTER (WHERE ${judulKeyExpr} = '${cat}') AS ${category}_memo`;
        })
        .join(',\n');

      const tempHasil = `temp_pivot_statuspendukung_${Math.random().toString(36).substring(2, 15)}`;

      await trx.raw(`
        CREATE TEMP TABLE "${tempHasil}"
        ON COMMIT DROP
        AS
        SELECT
          a.id,
          a.nobukti,
          ${categoryColumns}
        FROM ${tablename} a
        INNER JOIN statuspendukung b ON a.id = b.transaksi_id
        INNER JOIN parameter c ON b.statusdatapendukung = c.id
        INNER JOIN parameter d ON b.statuspendukung = d.id
        WHERE c.subgrp = '${tablename}'
        GROUP BY a.id, a.nobukti
      `);

      return tempHasil;
    } catch (error) {
      console.error('Error building status pendukung pivot table:', error);
      throw new Error('Failed to build status pendukung pivot table');
    }
  }

  getTime() {
    return DateTime.now()
      .setZone('Asia/Jakarta') // Use the timezone you need
      .toFormat('yyyy-MM-dd HH:mm:ss'); // Ensure proper SQL-compatible format
  }

  hasChanges(newData: any, existingData: any) {
    for (const key in newData) {
      if (key === 'created_at' || key === 'updated_at') {
        continue;
      }

      if (newData[key] != existingData[key]) {
        return true;
      }
    }
    return false;
  }

  async lockAndDestroy(identifier: any, table: string, field: any = 'id', trx) {
    try {
      // Cek dulu apakah data ada
      const record = await trx(table)
        .where(field, identifier)

        .first();

      // Jika data tidak ada, tidak perlu return error, cukup keluar dari fungsi
      if (!record) {
        return true;
      }

      const isDeleted = await trx(table).where(field, identifier).delete();

      if (!isDeleted) {
        throw new InternalServerErrorException(
          `Gagal menghapus '${field}' = '${identifier}' di tabel '${table}'`,
        );
      }

      return record;
    } catch (error) {
      console.error('Error di lockAndDestroy:', error);
      throw error;
    }
  }

  /**
   * Cari baris anak pertama yang masih mereferensikan `tableName`.id = value lewat
   * foreign key (baca katalog PG, jadi otomatis mengikuti SEMUA FK yang ada).
   * Mengembalikan { ref_table, ref_column } bila masih dipakai, atau null bila
   * aman dihapus. `excludeTables` untuk melewati tabel yang referensinya ikut
   * terhapus (mis. tabel master itu sendiri saat mengecek relasi_id-nya —
   * `<master>.relasi_id` adalah self-reference yang dihapus lebih dulu).
   */
  async findFirstReference(
    tableName: string,
    value: any,
    trx: any,
    excludeTables: string[] = [],
  ): Promise<{ ref_table: string; ref_column: string } | null> {
    const refsResult = await trx.raw(
      `select distinct src.relname as ref_table, att.attname as ref_column
         from pg_constraint con
         join pg_class tgt on tgt.oid = con.confrelid
         join pg_class src on src.oid = con.conrelid
         join pg_attribute att on att.attrelid = con.conrelid
                              and att.attnum = con.conkey[1]
        where con.contype = 'f' and tgt.relname = ?`,
      [tableName],
    );
    const refs = refsResult?.rows ?? refsResult ?? [];
    for (const r of refs) {
      if (excludeTables.includes(r.ref_table)) continue;
      const hit = await trx(r.ref_table).where(r.ref_column, value).first();
      if (hit) {
        return { ref_table: r.ref_table, ref_column: r.ref_column };
      }
    }
    return null;
  }

  async getUserByUsername(username: string): Promise<Users | null> {
    try {
      const user = await dbMssql('users').where({ username }).first();
      return user || null;
    } catch (error) {
      console.error('Error fetching user by username:', error);
      throw new Error('Database query failed');
    }
  }

  async fetchKaryawanByUserId(userId: number): Promise<any> {
    try {
      const karyawan = await dbMssql('karyawan')
        .select('karyawan.*', 'c.nama as cabang_nama')
        .leftJoin('users', 'users.karyawan_id', 'karyawan.id')
        .leftJoin('cabang as c', 'c.id', 'karyawan.cabang_id')
        .where('users.id', userId)
        .first();

      return karyawan || null;
    } catch (error) {
      console.error('Error fetching karyawan by user ID:', error);
      throw new Error('Database query failed');
    }
  }
  async fetchUserRolesAndAbilities(
    // user ids are varchar strings (e.g. "02-E0CF9E01-..."); accept number too
    // for callers that still type the id numerically. The value is used as-is
    // in the WHERE clause, so it must NOT be coerced with +id (NaN breaks SQL).
    userId: string | number,
    trx,
  ): Promise<UserRoleAbilities> {
    const roles = await trx('userrole')
      .where({ user_id: userId })
      .pluck('role_id');

    if (roles.length === 0) {
      return { roles: [], abilities: [] };
    }

    const userAbilities = await trx('useracl')
      .join('acos', 'useracl.aco_id', 'acos.id')
      .where('useracl.user_id', userId)
      .select({
        id: 'acos.id',
        method: 'acos.method',
        class: 'acos.class',
      })
      .distinct('acos.id');
    const roleAbilities = await trx('acl')
      .join('acos', 'acl.aco_id', 'acos.id')
      .whereIn('acl.role_id', roles)
      .select({
        id: 'acos.id',
        method: 'acos.method',
        class: 'acos.class',
      })
      .distinct('acos.id');

    // Gabungkan kedua array dan pastikan id yang dihasilkan berupa nilai tunggal.
    const allAbilities = [
      ...userAbilities.map((ability) => ({
        id: Array.isArray(ability.id) ? ability.id[0] : ability.id,
        action: ability.method,
        subject: ability.class,
      })),
      ...roleAbilities.map((ability) => ({
        id: Array.isArray(ability.id) ? ability.id[0] : ability.id,
        action: ability.method,
        subject: ability.class,
      })),
    ];

    // Gunakan Map untuk menghilangkan duplikat berdasarkan id.
    const uniqueAbilities = [
      ...new Map(allAbilities.map((ability) => [ability.id, ability])).values(),
    ];

    return {
      roles,
      abilities: uniqueAbilities,
    };
  }
  async fetchUserRolesAndUserAcl(
    // Sama seperti fetchUserRolesAndAbilities: user id kini varchar (uuid v7),
    // jadi nilainya dipakai apa adanya di WHERE — jangan dipaksa ke number.
    userId: string | number,
    trx: any,
  ): Promise<UserRoleAbilities> {
    const roles = await trx('userrole')
      .where({ user_id: userId })
      .pluck('role_id');

    if (roles.length === 0) {
      return { roles: [], abilities: [] };
    }

    const userAbilities = await trx('useracl')
      .join('acos', 'useracl.aco_id', 'acos.id')
      .where('useracl.user_id', userId)
      .select({
        id: 'acos.id',
        method: 'acos.method',
        class: 'acos.class',
      })
      .distinct('acos.id');

    // Gabungkan kedua array dan pastikan id yang dihasilkan berupa nilai tunggal.
    const allAbilities = [
      ...userAbilities.map((ability) => ({
        id: Array.isArray(ability.id) ? ability.id[0] : ability.id,
        action: ability.method,
        subject: ability.class,
      })),
    ];

    // Gunakan Map untuk menghilangkan duplikat berdasarkan id.
    const uniqueAbilities = [
      ...new Map(allAbilities.map((ability) => [ability.id, ability])).values(),
    ];

    return {
      roles,
      abilities: uniqueAbilities,
    };
  }

  checkAccessRecursively = (item: any, abilities: any[]): boolean => {
    return abilities.some((ability: any) => {
      const subject = ability.subject?.toLowerCase() || '';
      const url = item.url?.toLowerCase() || '';
      const title = item.title?.toLowerCase() || '';

      const isSubjectMatching = subject === title || subject === url;
      const isActionMatching = ability.action === 'GET';

      if (isSubjectMatching && isActionMatching) {
        return true;
      }

      if (item.items && item.items.length > 0) {
        return item.items.some((subItem: any) =>
          this.checkAccessRecursively(subItem, abilities),
        );
      }

      return false;
    });
  };

  buildMenuString = (menuItems: any[], abilities: any[]): string => {
    let menuHtml = '';
    const processMenuItem = (item: any): string => {
      if (this.checkAccessRecursively(item, abilities)) {
        let itemHtml = '';
        const uniqueTitle = `${item.title}-${item.id}`;

        if (item.items && item.items.length > 0) {
          itemHtml += `<Collapsible asChild defaultOpen={true} open={isMenuOpen('${uniqueTitle}')} className="group/collapsible text-sm my-1"><SidebarMenuItem><CollapsibleTrigger asChild><SidebarMenuButton className="text-sm" tooltip="${uniqueTitle}" onClick={()=>handleToggle('${uniqueTitle}')}><Icons name="${item.icon}" className="icon-white" /><p className="break-words text-sm">${item.title}</p><ChevronRight className={\`ml-auto transform transition-transform duration-300 ease-in-out \${isMenuOpen('${uniqueTitle}') ? 'rotate-90' : ''}\`} /></SidebarMenuButton></CollapsibleTrigger><CollapsibleContent><SidebarMenuSub>${this.buildMenuString(item.items, abilities)}</SidebarMenuSub></CollapsibleContent></SidebarMenuItem></Collapsible>`;
        } else {
          itemHtml += `<SidebarMenuSubItem onMouseEnter={() => setHoveredItemId('${uniqueTitle}')} onMouseLeave={() => setHoveredItemId(null)}><SidebarMenuSubButton asChild isActive={activePath==="/dashboard/${item.url}"}><Link prefetch={true} href="/dashboard/${item.url}" className="py-4"><Icons name="${item.icon}" className={ hoveredItemId === '${uniqueTitle}' || activePath === "/dashboard/${item.url}" ? 'icon-white text-white' : 'icon-white text-white'}/><p className="break-words text-sm">${item.title}</p></Link></SidebarMenuSubButton></SidebarMenuSubItem>`;
        }
        return itemHtml.trim();
      }
      return '';
    };

    menuItems.forEach((item) => {
      menuHtml += processMenuItem(item);
    });
    return menuHtml.replace(/\s+/g, ' ').trim();
  };

  async getDataMenuSidebar(trx: any) {
    try {
      const result = await trx
        .select(
          'menus.id',
          'menus.title',
          trx.raw(
            `CASE WHEN acos.method = 'GET' THEN LOWER(acos.class) ELSE NULL END AS url`,
          ),
          'menus.icon',
          'menus.isactive as isActive',
          'menus.parentid as parentId',
          'menus.order',
        )
        .from('menus')
        .leftJoin('acos', 'menus.aco_id', 'acos.id')
        .orderBy('menus.parentid')
        .orderBy('menus.order');

      const formattedMenus = this.formatMenus(result);
      return formattedMenus;
    } catch (error) {
      console.error('Error fetching menu sidebar data:', error);
      throw new Error('Failed to fetch menu sidebar data');
    }
  }

  formatMenus(rawData: any[]): Menu[] {
    const map: { [key: number]: Menu } = {};
    const roots: Menu[] = [];

    rawData.forEach((menu: any) => {
      map[menu.id] = {
        id: menu.id,
        title: menu.title,
        url: menu.url || '',
        icon: menu.icon || '',
        isActive: menu.isActive === true,
        order: menu.order || 0,
        parentId: menu.parentId || 0,
        items: [],
      };
    });

    rawData.forEach((menu: any) => {
      // Postgres: parentid bertipe text → root bisa '0' (string), bukan 0 (number)
      const isRootParent =
        menu.parentId === 0 ||
        menu.parentId === '0' ||
        menu.parentId === null ||
        menu.parentId === undefined ||
        menu.parentId === '';
      if (isRootParent) {
        roots.push(map[menu.id]);
      } else if (map[menu.parentId]) {
        map[menu.parentId].items.push(map[menu.id]);
      }
    });

    const sortItems = (items: Menu[]): Menu[] => {
      return items
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          ...item,
          items: sortItems(item.items),
        }));
    };

    return sortItems(roots);
  }
  async compressImageKaryawan(file: Express.Multer.File): Promise<string> {
    const outputDir = path.join(process.cwd(), 'uploads/compress');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const extname = path.extname(file.originalname);
    const timestamp = Date.now();
    const combinedName = `${timestamp}${extname}`;
    // Nama file untuk medium (disimpan dengan nama medium_)
    const mediumName = `medium_${timestamp}${extname}`;
    const mediumPath = path.join(outputDir, mediumName);

    // Nama file untuk thumbnail (disimpan dengan nama small_)
    const thumbnailName = `small_${timestamp}${extname}`;
    const thumbnailPath = path.join(outputDir, thumbnailName);

    const format = mimeToSharpFormat[file.mimetype]; // Pastikan mimeToSharpFormat didefinisikan dengan benar

    // Menyimpan gambar medium dengan ukuran asli (tanpa resize)
    fs.writeFileSync(mediumPath, file.buffer);

    // Resize gambar untuk thumbnail (100px lebar)
    const thumbnailBuffer = await sharp(file.buffer)
      .resize(100) // Resize image to 100px width for thumbnail
      .toFormat(format) // Convert image to appropriate format
      .toBuffer();
    fs.writeFileSync(thumbnailPath, thumbnailBuffer); // Menyimpan gambar thumbnail

    return combinedName; // Return nama file asli, bukan nama medium atau small
  }

  async compressImage(file: Express.Multer.File): Promise<string> {
    const outputDir = path.join(process.cwd(), 'uploads/compress');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const extname = path.extname(file.originalname);
    const fileName = `medium_${Date.now()}${extname}`; // Menambahkan 'medium_' sebelum nama file
    const filePath = path.join(outputDir, fileName);

    const format = mimeToSharpFormat[file.mimetype]; // Pastikan mimeToSharpFormat didefinisikan dengan benar
    const compressedImageBuffer = await sharp(file.buffer)
      .resize(1200) // Resize image to 1200px width
      .toFormat(format) // Convert image to appropriate format
      .toBuffer();

    fs.writeFileSync(filePath, compressedImageBuffer);
    return fileName; // Return the name of the compressed file
  }
}

export function parseDDMMYYYY(dateString: string): Date | null {
  const [day, month, year] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return isNaN(date.getTime()) ? null : date;
}
// Fungsi validasi dinamis untuk cek apakah data sudah ada berdasarkan kolom tertentu
export async function isRecordExist(
  column: string,
  value: string | number,
  table: string,
  excludeId?: number | string,
): Promise<boolean> {
  const existingRecordQuery = dbMssql(table) // Ganti dengan query builder yang Anda pakai, misalnya knex.js
    .select('*')
    .where(column, value); // Cek jika ada username dengan value yang diberikan

  // Jika ada excludeId, kita exclude pengecekan pada record dengan id tersebut
  if (excludeId) {
    existingRecordQuery.whereNot('id', excludeId);
  }

  const existingRecord = await existingRecordQuery.first(); // Mendapatkan satu data saja
  return existingRecord !== undefined; // Jika ada, return true
}

// Versi case-insensitive + trim dari isRecordExist. Postgres menganggap '='
// pada string sebagai case-sensitive, sehingga isRecordExist yang biasa TIDAK
// menangkap "TEST" vs "test" vs " test " sebagai duplikat. Fungsi ini
// menyamai perilaku collation MSSQL lama (case-insensitive) untuk cek keunikan
// nama master seperti trado.
export async function isRecordExistCI(
  column: string,
  value: string,
  table: string,
  excludeId?: number | string,
): Promise<boolean> {
  const query = dbMssql(table).whereRaw('lower(trim(??)) = lower(trim(?))', [
    column,
    value,
  ]);

  // Jika ada excludeId, exclude pengecekan pada record dengan id tersebut
  if (excludeId) {
    query.whereNot('id', excludeId);
  }

  const existingRecord = await query.first();
  return existingRecord !== undefined;
}
export function convertToDateFormat(dateString) {
  const [day, month, year] = dateString.split('-');
  return `${year}/${month}/${day}`;
}
export function formatEmailDate(input: string | Date): string {
  let date: Date;

  if (typeof input === 'string') {
    // Cek apakah formatnya DD-MM-YYYY (ada dua strip dan panjang tiap segmen 2–4 digit)
    const parts = input.split('-');
    if (
      parts.length === 3 &&
      parts[0].length === 2 &&
      parts[1].length === 2 &&
      parts[2].length === 4
    ) {
      // parts = [DD, MM, YYYY]
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // JavaScript bulan: 0–11
      const year = parseInt(parts[2], 10);
      date = new Date(year, month, day);
    } else {
      // fallback ke parser bawaan (misalnya ISO 2025-06-03)
      date = new Date(input);
    }
  } else {
    date = input;
  }

  if (isNaN(date.getTime())) {
    // Kalau tetap invalid, kembalikan string kosong atau pesan error sederhana
    return '–– INVALID DATE ––';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('id-ID', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}
export function addcslashes(str: string, chars: string): string {
  const escapedChars = chars
    .split('')
    .map((char) => `\\${char}`)
    .join('');
  const regex = new RegExp(`[${escapedChars}]`, 'g');
  return str.replace(regex, '\\$&');
}

export async function getLastNumber(
  trx: any,
  table: string,
  year: number,
  month: number,
  type: string,
  statusformat: string,
) {
  if (type === 'RESET BULAN') {
    return trx(table)
      .where('tglbukti', '>=', `${year}-${month}-01`)
      .andWhere('tglbukti', '<', `${year}-${month + 1}-01`)
      .andWhere('statusformat', statusformat)
      .orderBy('nobukti', 'desc')
      .first();
  }

  if (type === 'RESET TAHUN') {
    return trx(table)
      .where('tglbukti', '>=', `${year}-01-01`)
      .andWhere('tglbukti', '<', `${year + 1}-01-01`)
      .andWhere('statusformat', statusformat)
      .orderBy('nobukti', 'desc')
      .first();
  }

  const query = await trx(table)
    .select('nobukti')
    .where('statusformat', statusformat)
    .orderBy('nobukti', 'desc')
    .first();

  return query;
}
// Pakai ini, ganti fungsi lama
export const formatDateToSQL = (input?: string | null | any): string | null => {
  const s = String(input ?? '').trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  // Handle Date object
  if (input instanceof Date) {
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const day = String(input.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Handle ISO 8601 dan variants
  // Matches: 2025-09-10T00:00:00.000Z, 2025-09-10T00:00:00, etc.
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(T|$)/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return isValid(y, m, d) ? `${y}-${m}-${d}` : null;
  }

  // DD-MM-YYYY → konversi ke YYYY-MM-DD
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return isValid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  // DD/MM/YYYY → konversi ke YYYY-MM-DD (optional: handle slash separator)
  const dmySlash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmySlash) {
    const [, d, m, y] = dmySlash;
    return isValid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  // Format lain tidak didukung
  return null;

  function isValid(y: string, m: string, d: string): boolean {
    const yy = Number(y),
      mm = Number(m),
      dd = Number(d);
    if (yy < 1000 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    const dt = new Date(yy, mm - 1, dd);
    return (
      dt.getFullYear() === yy && dt.getMonth() === mm - 1 && dt.getDate() === dd
    );
  }

  function pad(n: string | number): string {
    const v = Number(n);
    return v < 10 ? `0${v}` : String(v);
  }
};

export const formatDateTimeToSQL = (val: string) => {
  const raw = String(val).trim().replace('T', ' ');
  const [d, t = '00:00'] = raw.split(' ');
  const [hh = '00', mm = '00', ss = '00'] = t.split(':');
  return `${d} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}.000`;
};
// CHR(63) = '?' (bukan CHAR(63): di PostgreSQL CHAR adalah tipe data, bukan
// fungsi). Dipakai untuk menyisipkan '?' ke SQL tanpa memicu binding '?' knex.
export const tandatanya = 'CHR(63)';
// Helper functions (diperbaiki untuk format US input, output Indonesia)
export function parseNumberWithSeparators(str: string): number {
  if (!str || typeof str !== 'string') return NaN;

  // Hapus spasi dan koma (pemisah ribuan US style)
  const cleaned = str.trim().replace(/,/g, '');

  // parseFloat akan handle titik sebagai desimal
  return parseFloat(cleaned);
}

export function formatIndonesianNumber(
  num: number,
  includeDecimals: boolean = false,
): string {
  if (isNaN(num) || num < 0) return '0'; // Hanya untuk positif

  // Gunakan locale 'id-ID' untuk titik ribuan dan koma desimal
  const options: Intl.NumberFormatOptions = {
    style: 'decimal',
    minimumFractionDigits: includeDecimals ? 2 : 0,
    maximumFractionDigits: includeDecimals ? 2 : 0,
  };

  let formatted = num.toLocaleString('id-ID', options);

  // Jika desimal adalah ',00', hapus untuk clean (opsional, sesuaikan kebutuhan)
  if (!includeDecimals && formatted.endsWith(',00')) {
    formatted = formatted.slice(0, -4); // Hapus ',00'
  }

  return formatted;
}

// Fungsi helper untuk format negatif (untuk log nominalValue)
export function formatIndonesianNegative(num: number): string {
  if (isNaN(num)) return '0';
  const absNum = Math.abs(num);
  const formattedAbs = formatIndonesianNumber(absNum);
  return num < 0 ? `-${formattedAbs}` : formattedAbs;
}
export function generateUUID(prefix?: string): string {
  const uuid = uuidv7();
  return prefix ? `${uuid}-${prefix}` : uuid;
}
export function getFetchedPages(
  pageNumber: number,
  totalPages: number,
): number[] {
  const pagesToFetch: number[] = [];

  // Tentukan rentang awal & akhir
  let start = pageNumber - 2;
  let end = pageNumber + 2;

  // Jika start < 1, geser ke kanan
  if (start < 1) {
    end += 1 - start;
    start = 1;
  }

  // Jika end > totalPages, geser ke kiri
  if (end > totalPages) {
    start -= end - totalPages;
    end = totalPages;

    if (start < 1) start = 1; // jaga batas minimum
  }

  // Push ke array
  for (let i = start; i <= end; i++) {
    pagesToFetch.push(i);
  }

  return pagesToFetch;
}
export function extractFetchedPageData<T>(
  allData: T[],
  fetchedPages: number[],
  limit: number,
): T[] {
  const results: T[] = [];

  fetchedPages.forEach((page: number) => {
    const start = (page - 1) * limit;
    const end = page * limit;
    const pageData = allData.slice(start, end);

    results.push(...pageData);
  });

  return results;
}
export function calculateItemIndex(itemPosition, fetchedPages, limit) {
  // itemPosition adalah posisi global (1-based) dari query COUNT
  // fetchedPages adalah array page numbers yang di-fetch
  // limit adalah items per page

  // Page dimana item berada (1-based)
  const itemPage = Math.ceil(itemPosition / limit);

  // Index item dalam page tersebut (0-based dalam page)
  const indexInPage = (itemPosition - 1) % limit;

  // Hitung index dalam fetched data
  // Cari posisi itemPage dalam fetchedPages
  const sortedPages = [...fetchedPages].sort((a, b) => a - b);
  const itemPageIndex = sortedPages.indexOf(itemPage);

  if (itemPageIndex === -1) {
    // Item page tidak ada dalam fetchedPages (seharusnya tidak terjadi)
    console.warn(
      `Item page ${itemPage} not found in fetchedPages`,
      fetchedPages,
    );
    return {
      zeroBasedIndex: itemPosition - 1,
      oneBasedIndex: itemPosition,
    };
  }

  // Hitung total items dari pages sebelum itemPage dalam fetchedPages
  let itemsBeforePage = 0;
  for (let i = 0; i < itemPageIndex; i++) {
    itemsBeforePage += limit;
  }

  // Index dalam fetched data (0-based)
  const zeroBasedIndex = itemsBeforePage + indexInPage;
  const oneBasedIndex = zeroBasedIndex + 1;

  return {
    zeroBasedIndex,
    oneBasedIndex,
  };
}
export function splitDataByPages(
  allData: any[],
  pages: number[],
  limit: number,
) {
  const paged: Record<number, any[]> = {};

  pages.forEach((page) => {
    const start = (page - 1) * limit;
    const end = page * limit;

    paged[page] = allData.slice(start, end);
  });

  return paged;
}
// Kode cabang dari parameter. Kolom `memo` bertipe text berisi JSON, jadi
// diekstrak dengan operator jsonb (`memo::jsonb ->> 'KODE CABANG'`).
async function getKodeCabang(trx: any): Promise<string> {
  const parameter = await trx('parameter')
    .where('grp', 'CABANG')
    .andWhere('subgrp', 'CABANG')
    .select('*', trx.raw(`(memo::jsonb ->> 'KODE CABANG') as kode_cabang`))
    .first();

  return parameter?.kode_cabang ?? '00';
}

// Generate `count` uuid v7 (berprefix kode cabang) dalam SATU query lewat
// fungsi Postgres public.get_uuid_v7().
async function generateUuidV7Rows(
  trx: any,
  kodeCabang: string,
  count: number,
): Promise<string[]> {
  const result = await trx.raw(
    `SELECT ? || '-' || public.get_uuid_v7()::text AS uuid
       FROM generate_series(1, ?) AS g(i)`,
    [kodeCabang, count],
  );

  // knex-pg mengembalikan { rows: [...] }; driver lain array langsung.
  const rows = result?.rows ?? result ?? [];
  return rows.map((row: any) => row?.uuid).filter(Boolean);
}

export async function uuidV7(trx: any): Promise<string> {
  const kodeCabang = await getKodeCabang(trx);
  const [uuid] = await generateUuidV7Rows(trx, kodeCabang, 1);
  return uuid ?? null;
}

/**
 * Generate banyak uuid v7 sekaligus dengan 2 query saja (kode cabang + batch),
 * BUKAN 2 query per baris.
 *
 * Sebelumnya insert massal memanggil uuidV7() per baris: 591 baris ACL = 1.182
 * round-trip DB berurutan, yang membuat PUT /roleacl kena timeout.
 */
export async function uuidV7Many(
  trx: any,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];

  const kodeCabang = await getKodeCabang(trx);
  const uuids = await generateUuidV7Rows(trx, kodeCabang, count);

  // Batch path mengandalkan get_uuid_v7() dievaluasi per baris (VOLATILE).
  // Kalau ternyata di-fold jadi satu nilai konstan, hasilnya duplikat dan akan
  // bentrok primary key — deteksi di sini lalu jatuh ke jalur per-baris.
  if (uuids.length === count && new Set(uuids).size === count) {
    return uuids;
  }

  const fallback: string[] = [];
  for (let i = 0; i < count; i++) {
    const [uuid] = await generateUuidV7Rows(trx, kodeCabang, 1);
    fallback.push(uuid);
  }
  return fallback;
}

/**
 * Attaches a freshly generated uuidV7 to the `id` field before insert.
 * - For a single object: returns a copy with `id` set.
 * - For an array of rows: sets `id` on each row and returns it.
 *
 * Satu statement untuk seluruh array (bukan Promise.all): transaksi knex
 * memakai satu koneksi dan tidak bisa menjalankan query paralel.
 */
export async function withUuidV7(trx: any, data: any): Promise<any> {
  if (Array.isArray(data)) {
    const uuids = await uuidV7Many(trx, data.length);
    data.forEach((row: any, index: number) => {
      row.id = uuids[index];
    });
    return data;
  }
  return { ...data, id: await uuidV7(trx) };
}


// estimasi/nominal/nominaltagih bertipe money->numeric. Grid mengirimnya
// lewat InputCurrency sebagai string ter-format ("100,000.00"); koma
// ribuan ditolak PG dengan 22P02 invalid input syntax for type numeric.
// Kosong -> null (kolom nullable).
export const toNumeric = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null;
  const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(parsed) ? null : parsed;
};