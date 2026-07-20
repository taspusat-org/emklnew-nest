import { Injectable, Logger } from '@nestjs/common';
import { CreateJurnalumumdetailDto } from './dto/create-jurnalumumdetail.dto';
import { UpdateJurnalumumdetailDto } from './dto/update-jurnalumumdetail.dto';
import { withUuidV7, tandatanya, UtilsService  } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { filter } from 'rxjs';

@Injectable()
export class JurnalumumdetailService {
  private readonly tableName = 'jurnalumumdetail';
  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  private readonly logger = new Logger(JurnalumumdetailService.name);
  async create(details: any, id: any = 0, trx: any = null) {
    // Rewrite Postgres: TANPA temp table + OPENJSON (OPENJSON = fungsi SQL
    // Server, tak ada di PG; jsonExtract memakai jsonb_path_query yang
    // mengembalikan jsonb ber-quote). Upsert langsung dari array JS: update
    // per-baris, hapus yang tak dikirim, insert baru dgn withUuidV7.
    const time = this.utilsService.getTime();
    const logData: any[] = [];

    if (details.length === 0) {
      await trx(this.tableName).delete().where('jurnalumum_id', id);
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

    // UPDATE baris existing. nobukti/tglbukti/coa sengaja TIDAK diubah agar sama
    // dgn perilaku lama (UPDATE JOIN meng-set ketiganya ke nilai sendiri).
    let updatedData: any = null;
    for (const row of existingRows) {
      const res = await trx(this.tableName)
        .where('id', row.id)
        .update({
          keterangan: row.keterangan,
          nominal: row.nominal,
          info: row.info,
          modifiedby: row.modifiedby,
          jurnalumum_id: row.jurnalumum_id ?? id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })
        .returning('*');
      if (res && res[0]) updatedData = res[0];
    }

    // Baris di DB (jurnalumum_id = id) yang tak dikirim lagi → log DELETE, hapus.
    const incomingIds = existingRows.map((r) => r.id);
    const getDeleted = await trx(this.tableName)
      .where('jurnalumum_id', id)
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
      .where('jurnalumum_id', id)
      .modify((qb: any) => {
        if (incomingIds.length) qb.whereNotIn('id', incomingIds);
      })
      .del();

    // INSERT baris baru dgn uuid v7.
    let insertedData: any = null;
    if (newRows.length > 0) {
      const toInsert = newRows.map((r: any) => ({
        nobukti: r.nobukti,
        tglbukti: r.tglbukti,
        coa: r.coa,
        keterangan: r.keterangan,
        nominal: r.nominal,
        info: r.info,
        modifiedby: r.modifiedby,
        jurnalumum_id: id,
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
        postingdari: 'JURNAL UMUM DETAIL',
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
      t.integer('id').nullable();
      t.string('nobukti').nullable();
      t.text('link').nullable();
    });
    const url = 'jurnalumumheader';

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
          'p.jurnalumum_id',
          trx.raw("TO_CHAR(p.tglbukti, 'DD-MM-YYYY') as tglbukti"),
          'p.nobukti',
          'p.coa',
          'p.keterangan',
          'ap.keterangancoa as coa_nama',

          // Jika nominal < 0 → nominalkredit = ABS(nominal), selain itu 0
          trx.raw(
            'CASE WHEN p.nominal < 0 THEN ABS(p.nominal) ELSE 0 END AS nominalkredit',
          ),

          // Jika nominal > 0 → nominaldebet = nominal, selain itu 0
          trx.raw(
            'CASE WHEN p.nominal > 0 THEN p.nominal ELSE 0 END AS nominaldebet',
          ),

          trx.raw('ABS(p.nominal) AS nominal'),
          'p.info',
          'p.modifiedby',
          trx.raw("TO_CHAR(p.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at"),
          trx.raw("TO_CHAR(p.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at"),
          'tempUrl.link',
        )
        .innerJoin(trx.raw(`${tempUrl} as tempUrl`), 'p.id', 'tempUrl.id')
        .innerJoin(
          trx.raw('akunpusat as ap'),
          'p.coa',
          'ap.coa',
        )
        .orderBy('p.created_at', 'desc');

      if (filters?.nobukti) {
        query.where('p.nobukti', filters?.nobukti);
      }
      const excludeSearchKeys = ['tglDari', 'tglSampai', 'nobukti'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        console.log(search, 'search');
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            qb.orWhere(`p.${field}`, 'like', `%${sanitized}%`);
          });
        });
      }
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (key === 'pengeluaran_nobukti') {
            continue;
          }
          if (!value) continue;
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          switch (key) {
            case 'coa_nama':
              query.andWhere('ap.keterangancoa', 'like', `%${sanitizedValue}%`);
              break;

            case 'tglbukti':
              query.andWhereRaw("TO_CHAR(p.tglbukti, 'DD-MM-YYYY') LIKE ?", [
                `%${sanitizedValue}%`,
              ]);
              break;

            case 'nominaldebet':
              query.andWhere(
                trx.raw('CASE WHEN p.nominal > 0 THEN p.nominal ELSE 0 END'),
                'like',
                `%${sanitizedValue}%`,
              );
              break;

            case 'nominalkredit':
              query.andWhere(
                trx.raw(
                  'CASE WHEN p.nominal < 0 THEN ABS(p.nominal) ELSE 0 END',
                ),
                'like',
                `%${sanitizedValue}%`,
              );
              break;

            default:
              query.andWhere(`p.${key}`, 'like', `%${sanitizedValue}%`);
          }
        }
      }

      if (sort?.sortBy && sort?.sortDirection) {
        query.orderBy(sort.sortBy, sort.sortDirection);
      }
      const result = await query;
      return {
        data: result,
      };
    } catch (error) {
      console.error('Error in findAll Kas Gantung Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} jurnalumumdetail`;
  }

  update(id: string, updateJurnalumumdetailDto: UpdateJurnalumumdetailDto) {
    return `This action updates a #${id} jurnalumumdetail`;
  }

  remove(id: string) {
    return `This action removes a #${id} jurnalumumdetail`;
  }
}
