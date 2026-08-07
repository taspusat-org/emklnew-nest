import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateStatuspendukungDto } from './dto/create-statuspendukung.dto';
import { UpdateStatuspendukungDto } from './dto/update-statuspendukung.dto';
import { withUuidV7, UtilsService } from 'src/utils/utils.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';

@Injectable()
export class StatuspendukungService {
  private readonly tableName = 'statuspendukung';

  constructor(
    private readonly utilsService: UtilsService,
    private readonly logTrailService: LogtrailService,
  ) {}
  async create(
    tablename: string,
    id: any,
    modifiedby: any,
    trx: any,
    statuspendukung: any = 0,
  ) {
    const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)';
    console.log('masuk', tablename, id, modifiedby, statuspendukung);
    try {
      console.log('masuk222');
      const getDataRequest = await trx('parameter')
        .select(
          'id',
          'grp',
          'subgrp',
          'text',
          'kelompok',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI YA"') AS nilai_ya`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`),
        )
        .where('grp', 'DATA PENDUKUNG')
        .andWhere('subgrp', 'ilike', `%${tablename}%`);

      if (getDataRequest && getDataRequest.length > 0) {
        const payload = getDataRequest.map((data: any) => {
          const value = statuspendukung?.[data.text] ?? data.nilai_tidak;

          return {
            statusdatapendukung: data.id,
            transaksi_id: id,
            statuspendukung: value,
            keterangan: null,
            modifiedby: modifiedby,
            updated_at: this.utilsService.getTime(),
            created_at: this.utilsService.getTime(),
          };
        });
        await trx(this.tableName).insert(await withUuidV7(trx, payload));

        const insertedData = await trx(this.tableName)
          .where('transaksi_id', id)
          .andWhere('modifiedby', modifiedby)
          .orderBy('id', 'desc')
          .limit(payload.length);

        if (insertedData && insertedData.length > 0) {
          console.log(
            'Calling logTrailService.create with namatabel:',
            this.tableName,
          );
          await this.logTrailService.create(
            {
              namatabel: this.tableName,
              postingdari: `ADD STATUS PENDUKUNG`,
              idtrans: insertedData[0].id,
              nobuktitrans: insertedData[0].id,
              aksi: 'ADD',
              datajson: JSON.stringify(insertedData[0]),
              modifiedby: insertedData[0]?.modifiedby,
            },
            trx,
          );
        }

        return { success: true };
      }
      return { success: true };
    } catch (error) {
      throw new Error(error);
    }
  }

  findAll() {
    return `This action returns all statuspendukung`;
  }

  findOne(id: string) {
    return `This action returns a #${id} statuspendukung`;
  }

  async update(
    tablename: string,
    id: any,
    modifiedby: any,
    trx: any,
    statuspendukung: any = 0,
  ) {
    let payload;
    const memoExpr = '(CASE WHEN memo IS JSON THEN memo::jsonb END)'; // penting: TEXT/NTEXT -> text

    try {
      const getDataRequest = await trx('parameter')
        .select(
          'id',
          'grp',
          'subgrp',
          'text',
          'kelompok',
          trx.raw(`JSON_VALUE(${memoExpr}, '$.MEMO') AS memo_nama`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI YA"') AS nilai_ya`),
          trx.raw(`JSON_VALUE(${memoExpr}, '$."NILAI TIDAK"') AS nilai_tidak`),
        )
        .where('grp', 'DATA PENDUKUNG')
        .andWhere('subgrp', tablename);

      if (getDataRequest && getDataRequest.length > 0) {
        for (const [index, item] of getDataRequest.entries()) {
          const value = statuspendukung?.[item.text] ?? item.nilai_tidak;
          const getExistingData = await trx(this.tableName)
            .where('statusdatapendukung', item.id)
            .where('transaksi_id', id)
            .first();

          payload = {
            statusdatapendukung: item.id,
            transaksi_id: id,
            statuspendukung: value,
            keterangan: null,
            modifiedby: modifiedby,
            updated_at: this.utilsService.getTime(),
            created_at: this.utilsService.getTime(),
          };
          // console.log('payload', payload);

          const hasChanges = this.utilsService.hasChanges(
            payload,
            getExistingData,
          );
          // console.log('hasChanges', hasChanges);

          if (hasChanges) {
            const updatedData = await trx(this.tableName)
              .where('statusdatapendukung', item.id)
              .where('transaksi_id', id)
              .update(payload)
              .returning('*');
            // console.log('updatedData', updatedData);

            await this.logTrailService.create(
              {
                namatabel: this.tableName,
                postingdari: `ADD STATUS PENDUKUNG`,
                idtrans: updatedData[0].id,
                nobuktitrans: updatedData[0].id,
                aksi: 'ADD',
                datajson: JSON.stringify(updatedData[0]),
                modifiedby: updatedData[0]?.modifiedby,
              },
              trx,
            );
          }
        }

        return { success: true };
      }
      return { success: true };
    } catch (error) {
      throw new Error(error);
    }
  }

  async remove(id: string, modifiedby: string, trx: any) {
    try {
      const deletedDataDetail = await this.utilsService.lockAndDestroy(
        id,
        'statuspendukung',
        'transaksi_id',
        trx,
      );
      await this.logTrailService.create(
        {
          namatabel: this.tableName,
          postingdari: 'DELETE STATUS PENDUKUNG',
          idtrans: deletedDataDetail.id,
          nobuktitrans: deletedDataDetail.id,
          aksi: 'DELETE',
          datajson: JSON.stringify(deletedDataDetail),
          modifiedby: modifiedby,
        },
        trx,
      );

      return {
        status: 200,
        message: 'Data deleted successfully',
        deletedDataDetail,
      };
    } catch (error) {
      console.log('Error deleting data:', error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete data');
    }
  }
}
