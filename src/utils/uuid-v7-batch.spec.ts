import { uuidV7Many, withUuidV7 } from './utils.service';

type FakeTrxOptions = {
  duplicateBatch?: boolean;
};

function makeFakeTrx({ duplicateBatch = false }: FakeTrxOptions = {}) {
  let counter = 0;
  const batchCalls: number[] = [];

  const trx: any = () => ({
    where: () => ({
      andWhere: () => ({
        select: () => ({
          first: async () => ({ kode_cabang: '02' }),
        }),
      }),
    }),
  });

  trx.raw = jest.fn((sql: string, bindings?: any[]) => {
    if (!sql.includes('generate_series')) {
      // Dipakai sebagai fragmen select (kode cabang), bukan query yang dieksekusi.
      return sql;
    }

    const count = Number(bindings?.[1] ?? 0);
    batchCalls.push(count);

    const rows = Array.from({ length: count }, () => {
      const value = duplicateBatch && count > 1 ? 0 : counter++;
      return { uuid: `02-uuid-${value}` };
    });
    return Promise.resolve({ rows });
  });

  return { trx, batchCalls };
}

describe('uuid v7 batch generation', () => {
  it('membuat 591 uuid unik hanya dengan satu query batch', async () => {
    const { trx, batchCalls } = makeFakeTrx();

    const uuids = await uuidV7Many(trx, 591);

    expect(uuids).toHaveLength(591);
    expect(new Set(uuids).size).toBe(591);
    expect(batchCalls).toEqual([591]);
  });

  it('withUuidV7 memberi id ke setiap baris tanpa query per baris', async () => {
    const { trx, batchCalls } = makeFakeTrx();
    const rows = Array.from({ length: 591 }, (_, i) => ({ aco_id: `aco-${i}` }));

    const result = await withUuidV7(trx, rows);

    expect(result).toHaveLength(591);
    expect(result.every((row: any) => typeof row.id === 'string')).toBe(true);
    expect(new Set(result.map((row: any) => row.id)).size).toBe(591);
    expect(batchCalls).toEqual([591]);
  });

  it('jatuh ke jalur per-baris bila batch menghasilkan uuid duplikat', async () => {
    const { trx, batchCalls } = makeFakeTrx({ duplicateBatch: true });

    const uuids = await uuidV7Many(trx, 3);

    expect(new Set(uuids).size).toBe(3);
    // 1 batch gagal + 3 query tunggal sebagai fallback.
    expect(batchCalls).toEqual([3, 1, 1, 1]);
  });

  it('tidak melakukan query apa pun untuk count 0', async () => {
    const { trx, batchCalls } = makeFakeTrx();

    await expect(uuidV7Many(trx, 0)).resolves.toEqual([]);
    expect(batchCalls).toEqual([]);
  });
});
