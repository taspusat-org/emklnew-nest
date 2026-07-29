import { Injectable, Logger } from '@nestjs/common';
import { CreateManagermarketingdetailDto } from './dto/create-managermarketingdetail.dto';
import { UpdateManagermarketingdetailDto } from './dto/update-managermarketingdetail.dto';
import { withUuidV7, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class ManagermarketingdetailService {
  private readonly tableName = 'managermarketingdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(ManagermarketingdetailService.name);
  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
    // Server (tak ada di PG), dan nama temp `##temp_...` juga tak pernah cocok
    // dengan tabel yang dibuat createTempTable (helper itu membuang prefiks '#').
    // Upsert langsung dari array JS: update per-baris existing, hapus baris yang
    // tak dikirim lagi, insert baris baru dgn withUuidV7. Pola sama dengan
    // pengeluarandetail.service.ts.
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    // nominalawal/nominalakhir/persentase bertipe numeric. Grid mengirimnya
    // lewat InputCurrency sebagai string ter-format ("10,000"); koma ribuan
    // ditolak PG (22P02 invalid input syntax for type numeric). Kosong → null
    // (ketiga kolom nullable).
    const toNumeric = (value: any): number | null => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
      }
      const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
      return Number.isNaN(parsed) ? null : parsed;
    };

    if (details.length === 0) {
      await trx(this.tableName).delete().where('managermarketing_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
      data.nominalawal = toNumeric(data.nominalawal);
      data.nominalakhir = toNumeric(data.nominalakhir);
      data.persentase = toNumeric(data.persentase);

      const isNew = !data.id || String(data.id) === '0';
      if (!isNew) {
        const existingData = await trx(this.tableName)
          .where('id', data.id)
          .first();
        if (existingData) {
          data.created_at = existingData.created_at;
          data.updated_at = existingData.updated_at;
          if (this.utilsService.hasChanges(data, existingData)) {
            data.updated_at = time;
            data.aksi = 'UPDATE';
          } else {
            data.aksi = 'NO UPDATE';
          }
        } else {
          data.aksi = 'NO UPDATE';
        }
        existingRows.push(data);
      } else {
        data.created_at = time;
        data.updated_at = time;
        data.aksi = 'CREATE';
        newRows.push(data);
      }
      logData.push({ ...data, created_at: time });
    }

    // UPDATE baris existing (per baris)
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          nominalawal: row.nominalawal,
          nominalakhir: row.nominalakhir,
          persentase: row.persentase,
          statusaktif: row.statusaktif,
          info: row.info,
          modifiedby: row.modifiedby,
          managermarketing_id: row.managermarketing_id ?? id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (managermarketing_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('managermarketing_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .select('*');
    const pushToLogWithAction = getDeleted.map((entry: any) => ({
      ...entry,
      aksi: 'DELETE',
    }));
    const finalData = logData.concat(pushToLogWithAction);

    await trx(this.tableName)
      .where('managermarketing_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        nominalawal: r.nominalawal,
        nominalakhir: r.nominalakhir,
        persentase: r.persentase,
        statusaktif: r.statusaktif,
        info: r.info,
        modifiedby: r.modifiedby,
        managermarketing_id: id,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      insertedData = await trx(this.tableName)
        .insert(await withUuidV7(trx, toInsert))
        .returning('*')
        .then((result: any) => result[0]);
    }

    await this.logTrailService.create(
      {
        namatabel: this.tableName,
        postingdari: 'MANAGER MARKETING HEADER',
        idtrans: id,
        nobuktitrans: id,
        aksi: 'EDIT',
        datajson: JSON.stringify(finalData),
        modifiedby: details[0].modifiedby || 'unknown',
      },
      trx,
    );

    return updatedData || insertedData;
  }

  async findAll(id: string, trx: any) {
    const result = await trx
      .from(trx.raw(`${this.tableName} as p`))
      .select([
        'p.id',
        'p.managermarketing_id', // Updated field name
        'p.nominalawal',
        'p.nominalakhir',
        'p.persentase', // Updated field name
        'p.statusaktif',
        'p.info',
        'p.modifiedby',
        trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
        trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
        'g.memo',
        'g.text',
      ])
      .leftJoin(
        trx.raw('parameter as g'),
        'p.statusaktif',
        'g.id',
      )
      .where('p.managermarketing_id', id) // Updated field name
      // Urutkan SESUAI URUTAN ENTRY: created_at menaik (dulu 'desc' sehingga
      // baris terbaru tampil di atas dan urutan terbalik saat edit/view/delete).
      // `id` sebagai tiebreaker — satu kali simpan menulis created_at yang sama
      // persis untuk semua baris baru, dan uuid v7 urut waktu pembuatan.
      .orderBy('p.created_at', 'asc')
      .orderBy('p.id', 'asc');

    if (!result.length) {
      this.logger.warn(`No Data found for ID: ${id}`);
      return {
        status: false,
        message: 'No data found',
        data: [],
      };
    }

    return {
      status: true,
      message: 'Manager Marketing data fetched successfully',
      data: result,
    };
  }

  update(
    id: string,
    updateManagermarketingdetailDto: UpdateManagermarketingdetailDto,
  ) {
    return `This action updates2 a #${id} managermarketingdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} managermarketingdetail`;
  }
}
