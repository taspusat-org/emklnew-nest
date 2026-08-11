import { Test, TestingModule } from '@nestjs/testing';
import { autoMocker } from 'src/test/automock';
import { RunningNumberService } from './running-number.service';

type SlotRow = { first_gap: number; max_num: number };

function makeTrx(slot: SlotRow, taken: Set<string> = new Set()) {
  const stats = { rawCalls: 0, existsProbes: 0 };
  let lastSql = '';
  let lastBindings: any[] = [];

  const trx: any = (table: string) => {
    const wheres: Record<string, any> = {};
    const builder: any = {
      select: () => builder,
      where: (col: string, val: any) => {
        wheres[col] = val;
        return builder;
      },
      andWhere: (col: string, val: any) => {
        wheres[col] = val;
        return builder;
      },
      first: async () => {
        if (table === 'parameter') {
          // Panggilan pertama mencari format via grp/subgrp, kedua resolve type.
          return wheres.grp
            ? { id: 'param-1', text: 'JU #9999#/#R#/#Y#', type: 'type-1' }
            : { text: 'RESET BULAN' };
        }
        stats.existsProbes++;
        const value = Object.values(wheres)[0] as string;
        return taken.has(value) ? { nobukti: value } : undefined;
      },
    };
    return builder;
  };

  trx.raw = async (sql: string, bindings: any[]) => {
    stats.rawCalls++;
    lastSql = sql;
    lastBindings = bindings;
    return { rows: [slot] };
  };

  return {
    trx,
    stats,
    getSql: () => lastSql,
    getBindings: () => lastBindings,
  };
}

describe('RunningNumberService', () => {
  let service: RunningNumberService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RunningNumberService],
    })
      .useMocker(autoMocker)
      .compile();

    service = module.get<RunningNumberService>(RunningNumberService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const generate = (trx: any) =>
    service.generateRunningNumber(
      trx,
      'NOMOR PENERIMAAN',
      'NOMOR PENERIMAAN JURNAL',
      'jurnalumumheader',
      '15-01-2026',
    );

  it('memakai nomor bebas terkecil dari SQL dan mem-padding sesuai format', async () => {
    const { trx, stats } = makeTrx({ first_gap: 7, max_num: 120 });

    await expect(generate(trx)).resolves.toBe('JU 0007/I/2026');
    expect(stats.rawCalls).toBe(1);
    expect(stats.existsProbes).toBe(1);
  });

  it('menghitung slot lewat satu query, bukan menarik nobukti ke Node', async () => {
    const { trx, getSql, getBindings } = makeTrx({
      first_gap: 1,
      max_num: 0,
    });

    await generate(trx);

    const sql = getSql();
    expect(sql).toContain('WITH used AS');
    expect(sql).toContain('tglbukti >= ?');
    // RESET BULAN -> rentang satu bulan penuh, bukan seluruh tabel.
    expect(getBindings()).toEqual([
      'nobukti',
      '^JU (\\d+)/I/2026$',
      'jurnalumumheader',
      'nobukti',
      '^JU (\\d+)/I/2026$',
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('lompat ke max + 1 saat slot ternyata sudah dipakai (balapan transaksi)', async () => {
    const { trx, stats } = makeTrx(
      { first_gap: 7, max_num: 120 },
      new Set(['JU 0007/I/2026']),
    );

    await expect(generate(trx)).resolves.toBe('JU 0121/I/2026');
    // 1 probe untuk slot, 1 probe untuk max+1 — tidak menyusuri 8..120.
    expect(stats.existsProbes).toBe(2);
  });

  it('berhenti setelah batas percobaan alih-alih menggantung', async () => {
    const taken = new Set<string>();
    for (let i = 1; i <= 400; i++) {
      taken.add(`JU ${String(i).padStart(4, '0')}/I/2026`);
    }
    const { trx } = makeTrx({ first_gap: 1, max_num: 0 }, taken);

    await expect(generate(trx)).rejects.toThrow(
      'Unable to generate unique running number after maximum attempts',
    );
  });
});
