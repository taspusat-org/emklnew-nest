import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateScheduleKapalDto } from './dto/create-schedule-kapal.dto';
// import { UpdateScheduleKapalDto } from './dto/update-schedule-kapal.dto';
import {
  withUuidV7,
  formatDateToSQL,
  UtilsService,
  uuidV7,
  toNumeric,
  calculateItemIndex,
  getFetchedPages,
} from 'src/utils/utils.service';
import { RedisService } from 'src/common/redis/redis.service';
import { GlobalService } from '../global/global.service';
import { LogtrailService } from 'src/common/logtrail/logtrail.service';
import { FindAllParams } from 'src/common/interfaces/all.interface';
import { Knex } from 'knex';

@Injectable()
export class ScheduleKapalService {
  private readonly tableName: string = 'schedulekapal';
  private readonly viewName = 'vschedulekapal';
  private readonly logger = new Logger(ScheduleKapalService.name);

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly utilService: UtilsService,
    // private readonly locksService:
    private readonly redisService: RedisService,
    private readonly globalService: GlobalService,
    private readonly logTrailService: LogtrailService,
  ) {}

  private applyFilters(
    qb: any,
    filters: Record<string, any>,
    search?: string,
  ): void {
    const excludeSearchKeys = [
      'statusaktif',
      'text',
      'memo',
      'icon',
    ];

    const searchFields = Object.keys(filters || {}).filter(
      (k) => !excludeSearchKeys.includes(k),
    );
    const dateFields = [
      'tglberangkat',
      'tgltiba',
      'tglclosing',
      'created_at',
      'updated_at',
    ];

    if (search && searchFields.length > 0) {
      const sanitizedValue = String(search).trim();
      qb.where((query) => {
        searchFields.forEach((field) => {
          if (dateFields.includes(field)) {
            query.orWhereRaw(
              "TO_CHAR(vsk.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?",
              [field, `%${sanitizedValue}%`],
            );
          } else {
            query.orWhere(`vsk.${field}`, 'ilike', `%${sanitizedValue}%`);
          }
        });
      });
    }

    Object.entries(filters || {}).forEach(([key, rawValue]) => {
      if (rawValue === null || rawValue === undefined || rawValue === '')
        return;

      const sanitizedValue = String(rawValue);
      if (dateFields.includes(key)) {
        qb.andWhereRaw("TO_CHAR(vsk.??, 'DD-MM-YYYY HH24:MI:SS') ILIKE ?", [
          key,
          `%${sanitizedValue}%`,
        ]);
      } else if (key === 'text' || key === 'memo') {
        qb.andWhere(`vsk.statusaktif_${key}`, '=', sanitizedValue);
      } else {
        qb.andWhere(`vsk.${key}`, 'ilike', `%${sanitizedValue}%`);
      }
    });
  }

  private buildInsertData(dto: any, uuid?: string): Record<string, any> {
    return {
      id: uuid || dto.uuid || null,
      jenisorder_id: dto.jenisorder_id || null,
      voyberangkat: dto.voyberangkat ? dto.voyberangkat.toUpperCase() : null,
      keterangan: dto.keterangan ? dto.keterangan.toUpperCase() : null,
      kapal_id: dto.kapal_id || null,
      pelayaran_id: dto.pelayaran_id || null,
      tujuankapal_id: dto.tujuankapal_id || null,
      asalkapal_id: dto.asalkapal_id || null,
      tglberangkat: dto.tglberangkat || null,
      tgltiba: dto.tgltiba || null,
      tglclosing: dto.tglclosing || null,
      statusberangkatkapal: dto.statusberangkatkapal
        ? dto.statusberangkatkapal.toUpperCase()
        : null,
      statustibakapal: dto.statustibakapal
        ? dto.statustibakapal.toUpperCase()
        : null,
      batasmuatankapal: dto.batasmuatankapal
        ? dto.batasmuatankapal.toUpperCase()
        : null,

      statusaktif: dto.statusaktif,
      info: dto.info ? dto.info.toUpperCase() : null,
      modifiedby: dto.modifiedby,
      created_at: dto.created_at || this.utilService.getTime(),
      updated_at: dto.updated_at || this.utilService.getTime(),
    };
  }

  private resolvePositionOrder(
    sortBy: string,
    sortDirection: string,
  ): { col: string; dir: 'asc' | 'desc' } {
    const dir = sortDirection?.toLowerCase() === 'desc' ? 'desc' : 'asc';
    switch (sortBy) {
      case 'statusaktif':
        return { col: 'text', dir: 'asc' }; // findAll: hardcode 'asc' on vsk.text
      case 'statusbank':
        return { col: 'statusbank_text', dir };
      case 'statusdefault':
        return { col: 'statusdefault_text', dir };
      case 'statuslangsungcair':
        return { col: 'statuslangsungcair_text', dir };
      default:
        return { col: sortBy, dir };
    }
  }

  async create(CreateSchedulekapalDto: any, trx: any) {
    try {
      const { sortBy, sortDirection, filters, search, page, limit, info } =
        CreateSchedulekapalDto;

      const uuid = await uuidV7(trx);

      const insertData = this.buildInsertData(CreateSchedulekapalDto, uuid);
      await trx(this.tableName).insert(insertData);
      const newItem = await trx(this.viewName).where('id', uuid).first();

      const existingData = await trx(`${this.viewName} as vsk`)
        .where('id', newItem.id)
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();

      // 3. Hitung posisi & total dengan filter yang sama
      let posisi: number;
      let totalItems: number;

      // totalItems selalu dihitung dengan filter — fix bug utama
      const totalRecords = await trx(`${this.viewName} as vsk`)
        .count('id as total')
        .modify((qb) => this.applyFilters(qb, filters, search))
        .first();
      totalItems = Number(totalRecords?.total ?? 0);

      if (existingData) {
        const { col: posCol, dir: posDir } = this.resolvePositionOrder(
          sortBy,
          sortDirection,
        );
        const resultposition = await trx(`${this.viewName} as vsk`)
          .count('* as posisi')
          .where(posCol, posDir === 'desc' ? '>=' : '<=', existingData[posCol])
          .modify((qb) => this.applyFilters(qb, filters, search))
          .first();

        posisi = Number(resultposition?.posisi ?? 0);
      } else {
        posisi = 1;
      }

      // 4. Pagination
      const pageNumber = Math.ceil(posisi / limit);
      const totalPages = Math.ceil(totalItems / limit);
      const fetchedPages = getFetchedPages(pageNumber, totalPages);

      const startPage = fetchedPages[0];
      const endPage = fetchedPages[fetchedPages.length - 1];
      const customOffset = (startPage - 1) * limit;
      const totalDataNeeded = (endPage - startPage + 1) * limit;

      // 5. Fetch sekali, split di memory
      const result = await this.findAll(
        {
          search: search || '',
          filters: filters || {},
          pagination: { page: startPage, limit: totalDataNeeded, customOffset },
          sort: { sortBy, sortDirection: sortDirection.toLowerCase() },
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

      // 6. Side-effects
      await this.logTrailService.create(
        {
          texttabel: this.tableName,
          postingdari: 'ADD SCHEDULE KAPAL',
          idtrans: newItem.id,
          nobuktitrans: newItem.id,
          aksi: 'ADD',
          datajson: JSON.stringify(newItem),
          modifiedby: newItem.modifiedby,
        },
        trx,
      );

      await this.redisService.set(
        `${this.tableName}-page-${pageNumber}`,
        JSON.stringify(allFetchedData),
      );

      return {
        newItem,
        itemIndex: itemIndex.zeroBasedIndex,
        pageNumber,
        fetchedPages,
        pagedData,
      };
    } catch (error) {
      throw new Error(`Error creating schedule kapal: ${error.message}`);
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
    trx: Knex.Transaction,
  ) {
    try {
      const { page = 1, limit = 0, customOffset } = pagination ?? {};

      const sortBy = sort?.sortBy || 'text';
      const sortDirection =
        sort?.sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
      const safeFilters = filters || {};

      const countResult = await trx(`${this.viewName} as vsk`)
        .count('vsk.id as total')
        .modify((qb) => this.applyFilters(qb, safeFilters, search))
        .first();
      const total = Number(countResult?.total ?? 0);

      if (isLookUp && total > 500) {
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

      // SELECT disesuaikan DENGAN SCHEMA Schedulekapal yang sebenarnya
      const query = trx(`${this.viewName} as vsk`).select([
        'vsk.id',
        'vsk.jenisorder_id',
        'vsk.jenisorder_text',
        'vsk.voyberangkat',
        'vsk.keterangan',
        'vsk.kapal_id',
        'vsk.kapal_text',
        'vsk.pelayaran_id',
        'vsk.pelayaran_text',
        'vsk.tujuankapal_id',
        'vsk.tujuankapal_text',
        'vsk.asalkapal_id',
        'vsk.asalkapal_text',
        trx.raw("to_char(vsk.tglberangkat, 'DD-MM-YYYY') as tglberangkat"),
        trx.raw("to_char(vsk.tgltiba, 'DD-MM-YYYY') as tgltiba"),
        trx.raw(
          "to_char(vsk.tglclosing, 'DD-MM-YYYY HH24:MI:SS') as tglclosing",
        ),
        'vsk.statusberangkatkapal',
        'vsk.statustibakapal',
        'vsk.batasmuatankapal',
        'vsk.statusaktif',
        'vsk.memo',
        'vsk.text',
        'vsk.info',
        'vsk.modifiedby',
        trx.raw(
          "to_char(vsk.created_at, 'DD-MM-YYYY HH24:MI:SS') as created_at",
        ),
        trx.raw(
          "to_char(vsk.updated_at, 'DD-MM-YYYY HH24:MI:SS') as updated_at",
        ),
      ]);

      query.modify((qb) => this.applyFilters(qb, safeFilters, search));

      if (sortBy === 'statusaktif') {
        query.orderBy('vsk.text', sortDirection);
      } else {
        query.orderBy(`vsk.${sortBy}`, sortDirection);
      }

      const offset =
        useCustomOffset === true && customOffset !== undefined
          ? customOffset
          : (page - 1) * limit;

      if (limit > 0) {
        query.offset(offset).limit(limit);
      }

      const data = await query;
      const totalPages = Math.ceil(total / limit);
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
      this.logger.error('Error fetching schedule kapal data', error?.stack);
      throw new InternalServerErrorException(
        'Failed to fetch schedule kapal data',
      );
    }
  }

  findOne(id: string) {
    return `This action returns a #${id} scheduleKapal`;
  }

  update(id: string, updateScheduleKapalDto: any) {
    return `This action updates a #${id} scheduleKapal`;
  }

  remove(id: string) {
    return `This action removes a #${id} scheduleKapal`;
  }
}
