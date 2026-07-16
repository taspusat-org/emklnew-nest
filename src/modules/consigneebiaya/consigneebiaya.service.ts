import { Injectable } from '@nestjs/common';
import { CreateConsigneebiayaDto } from './dto/create-consigneebiaya.dto';
import { UpdateConsigneebiayaDto } from './dto/update-consigneebiaya.dto';
import { FindAllParams } from 'src/common/interfaces/all.interface';

@Injectable()
export class ConsigneebiayaService {
  private readonly tableName = 'consigneebiaya';
  create(createConsigneebiayaDto: CreateConsigneebiayaDto) {
    return 'This action adds a new consigneebiaya';
  }

  async findAll({ search, filters, sort }: FindAllParams, trx: any) {
    if (!filters?.consignee_id) {
      return {
        data: [],
      };
    }
    try {
      if (!filters?.consignee_id) {
        return {
          status: true,
          message: 'Jurnal umum Detail failed to fetch',
          data: [],
        };
      }
      const query = trx
        .from(
          trx.raw(`${this.tableName} as consigneebiaya`),
        )
        .select(
          'consigneebiaya.id',
          'consigneebiaya.consignee_id',
          'consigneebiaya.biayaemkl_id',
          'consigneebiaya.link_id',
          'consigneebiaya.container_id',
          'consigneebiaya.emkl_id',
          'consigneebiaya.nominalasuransi',
          'consigneebiaya.nominal',
          'consigneebiaya.info',
          'consigneebiaya.modifiedby',
          'p2.nama as container_nama',
          'p1.nama as biayaemkl_nama',
          'p3.nama as emkl_nama',
          trx.raw(
            "TO_CHAR(consigneebiaya.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
          ),
          trx.raw(
            "TO_CHAR(consigneebiaya.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
          ),
        )
        .leftJoin('biayaemkl as p1', 'consigneebiaya.biayaemkl_id', 'p1.id')
        .leftJoin('container as p2', 'consigneebiaya.container_id', 'p2.id')
        .leftJoin('emkl as p3', 'consigneebiaya.emkl_id', 'p3.id')
        .orderBy('consigneebiaya.created_at', 'desc');

      if (filters?.consignee_id) {
        query.where('consigneebiaya.consignee_id', filters?.consignee_id);
      }
      const excludeSearchKeys = ['consignee_id'];
      const searchFields = Object.keys(filters || {}).filter(
        (k) => !excludeSearchKeys.includes(k) && filters![k],
      );
      if (search) {
        const sanitized = String(search).replace(/\[/g, '[[]').trim();

        query.where((qb) => {
          searchFields.forEach((field) => {
            if (['created_at', 'updated_at'].includes(field)) {
              qb.orWhereRaw(
                "TO_CHAR(consigneebiaya.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [field, `%${sanitized}%`],
              );
            } else if (field === 'biayaemkl_nama') {
              qb.orWhere('p1.nama', 'like', `%${sanitized}%`);
            } else if (field === 'container_nama') {
              qb.orWhere('p2.nama', 'like', `%${sanitized}%`);
            } else if (field === 'emkl_nama') {
              qb.orWhere('p3.nama', 'like', `%${sanitized}%`);
            } else {
              qb.orWhere(`consigneebiaya.${field}`, 'like', `%${sanitized}%`);
            }
          });
        });
      }

      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          const sanitizedValue = String(value).replace(/\[/g, '[[]');

          if (value) {
            if (key === 'created_at' || key === 'updated_at') {
              query.andWhereRaw(
                "TO_CHAR(consigneebiaya.??, 'DD-MM-YYYY HH24:MI:SS') LIKE ?",
                [key, `%${sanitizedValue}%`],
              );
            } else if (key === 'biayaemkl_nama') {
              query.andWhere('p1.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'container_nama') {
              query.andWhere('p2.nama', 'like', `%${sanitizedValue}%`);
            } else if (key === 'emkl_nama') {
              query.andWhere('p3.nama', 'like', `%${sanitizedValue}%`);
            } else {
              query.andWhere(
                `consigneebiaya.${key}`,
                'like',
                `%${sanitizedValue}%`,
              );
            }
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
      console.error('Error in findAll Consignee Detail', error);
      throw new Error(error);
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} consigneebiaya`;
  }

  update(id: string, updateConsigneebiayaDto: UpdateConsigneebiayaDto) {
    return `This action updates a #${id} consigneebiaya`;
  }

  remove(id: string) {
    return `This action removes a #${id} consigneebiaya`;
  }
}
