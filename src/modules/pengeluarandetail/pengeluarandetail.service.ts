import { Injectable, Logger } from '@nestjs/common';
import { CreatePengeluarandetailDto } from './dto/create-pengeluarandetail.dto';
import { UpdatePengeluarandetailDto } from './dto/update-pengeluarandetail.dto';
import { withUuidV7, UtilsService, tandatanya  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class PengeluarandetailService {
  private readonly tableName = 'pengeluarandetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(PengeluarandetailService.name);
  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON. OPENJSON adalah fungsi SQL
    // Server (tak ada di PG), dan jsonExtract memakai jsonb_path_query yang
    // mengembalikan jsonb ber-quote (korupsi nilai). Upsert langsung dari array
    // JS: update per-baris existing, hapus baris yang tak dikirim (whereNotIn),
    // insert baris baru dgn withUuidV7. Nilai diambil langsung dari objek JS.
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (details.length === 0) {
      await trx(this.tableName).delete().where('pengeluaran_id', id);
      return;
    }

    const existingRows: any[] = []; // baris dgn id nyata (bukan '0'/kosong)
    const newRows: any[] = [];

    for (const data of details) {
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

    // UPDATE baris existing (per baris). coadebet & nobukti sengaja TIDAK diubah
    // agar sama persis dgn perilaku lama (UPDATE JOIN meng-set coadebet ke nilai
    // sendiri dan tidak menyertakan nobukti).
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          keterangan: row.keterangan,
          nominal: row.nominal,
          dpp: row.dpp,
          transaksibiaya_nobukti: row.transaksibiaya_nobukti,
          transaksilain_nobukti: row.transaksilain_nobukti,
          noinvoiceemkl: row.noinvoiceemkl,
          tglinvoiceemkl: row.tglinvoiceemkl,
          nofakturpajakemkl: row.nofakturpajakemkl,
          perioderefund: row.perioderefund,
          pengeluaranemklheader_nobukti: row.pengeluaranemklheader_nobukti,
          penerimaanemklheader_nobukti: row.penerimaanemklheader_nobukti,
          info: row.info,
          modifiedby: row.modifiedby,
          kasgantung_nobukti: row.kasgantung_nobukti,
          pengeluaran_id: row.pengeluaran_id ?? id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (pengeluaran_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('pengeluaran_id', id)
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
      .where('pengeluaran_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        coadebet: r.coadebet,
        nobukti: r.nobukti,
        keterangan: r.keterangan,
        nominal: r.nominal,
        dpp: r.dpp,
        transaksibiaya_nobukti: r.transaksibiaya_nobukti,
        transaksilain_nobukti: r.transaksilain_nobukti,
        noinvoiceemkl: r.noinvoiceemkl,
        tglinvoiceemkl: r.tglinvoiceemkl,
        nofakturpajakemkl: r.nofakturpajakemkl,
        perioderefund: r.perioderefund,
        pengeluaranemklheader_nobukti: r.pengeluaranemklheader_nobukti,
        penerimaanemklheader_nobukti: r.penerimaanemklheader_nobukti,
        info: r.info,
        modifiedby: r.modifiedby,
        kasgantung_nobukti: r.kasgantung_nobukti,
        pengeluaran_id: id,
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
        postingdari: 'PENGELUARAN HEADER',
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

  async findAll({ search, filters, sort }: FindAllParams, trx: any) {
    if (!filters?.nobukti) {
      return {
        data: [],
      };
    }
    const tempUrl = `##temp_url_${Math.random().toString(36).substring(2, 8)}`;

    await trx.schema.createTable(tempUrl, (t) => {
      // id pengeluarandetail = varchar(200) UUID. Pakai integer di sini bikin
      // "Conversion failed converting varchar '02-...' to int" saat insert ->
      // GET /pengeluarandetail 500.
      t.string('id', 200).nullable();
      t.string('nobukti').nullable();
      t.text('link').nullable();
    });
    const url = 'pengeluaran';
    await trx(tempUrl).insert(
      trx
        .select(
          'u.id',
          'u.nobukti',
          trx.raw(`
                STRING_AGG(
                  '<a target="_blank" className="link-color" href="/dashboard/${url}' + ${tandatanya} + 'nobukti=' + u.nobukti + '">' +
                  '<HighlightWrapper value="' + u.nobukti + '" />' +
                  '</a>', ','
                ) AS link
              `),
        )
        .from(this.tableName + ' as u')
        .groupBy('u.id', 'u.nobukti'),
    );
    try {
      if (!filters?.nobukti) {
        return {
          status: true,
          message: 'Jurnal umum Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(trx.raw(`${this.tableName} as p`))
        .select(
          'p.id',
          'p.pengeluaran_id',
          'p.coadebet',
          'p.nobukti',
          'p.keterangan',
          'p.nominal',
          'p.dpp',
          'p.transaksibiaya_nobukti',
          'p.transaksilain_nobukti',
          'p.noinvoiceemkl',
          trx.raw("TO_CHAR(p.tglinvoiceemkl, 'DD-MM-YYYY') as tglinvoiceemkl"),
          'p.nofakturpajakemkl',
          'p.perioderefund',
          'p.pengeluaranemklheader_nobukti',
          'p.penerimaanemklheader_nobukti',
          'q.keterangancoa as coadebet_text',
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
        )
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'p.id', 'tempUrl.id')
        .leftJoin(
          trx.raw('akunpusat as q'),
          'p.coadebet',
          'q.coa',
        )
        .orderBy('p.created_at', 'desc');
      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      const excludeSearchKeys = ['pengeluaran_id', 'coadebet'];

      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k),
      );

      if (search) {
        const sanitizedValue = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (
              ['created_at', 'updated_at', 'tglinvoiceemkl'].includes(field)
            ) {
              qb.orWhereRaw("TO_CHAR(p.??, 'DD-MM-YYYY HH24:MI:SS') like ?", [
                field,
                `%${sanitizedValue}%`,
              ]);
            } else if (field === 'coadebet_text') {
              qb.orWhere('q.keterangancoa', 'like', `%${sanitizedValue}%`);
            } else if (field === 'nominal' || field === 'dpp') {
              qb.orWhere(`p.${field}`, 'like', `%${Number(sanitizedValue)}%`);
            } else {
              qb.orWhere(`p.${field}`, 'like', `%${sanitizedValue}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'pengeluaran_nobukti') {
            continue;
          }
          const sanitizedValue = String(value).replace(/\[/g, '[[]');
          if (value) {
            switch (key) {
              case 'coadebet_text':
                query.andWhere(
                  'q.keterangancoa',
                  'like',
                  `%${sanitizedValue}%`,
                );
                break;
              case 'tglinvoiceemkl_dari':
                query.andWhere('p.tglinvoiceemkl', '>=', sanitizedValue);
                break;
              case 'tglinvoiceemkl_sampai':
                query.andWhere('p.tglinvoiceemkl', '<=', sanitizedValue);
                break;
              default:
                query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
            }
          }
        }
      }
      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }

      const result = await query;

      if (!result.length) {
        this.logger.warn(`No Data found`);
        return {
          status: false,
          message: 'No data found',
          data: [],
        };
      }

      return {
        status: true,
        message: 'Pengeluaran Detail data fetched successfully',
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Pengeluaran Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} pengeluarandetail`;
  }

  update(id: string, updatePengeluarandetailDto: UpdatePengeluarandetailDto) {
    return `This action updates a #${id} pengeluarandetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} pengeluarandetail`;
  }
}
