export interface FindAllParams {
  search?: string;
  filters?: Record<string, string | number>;
  isLookUp?: boolean;
  isReload?: boolean;
  exclude?: any;
  exactMatch?: any;
  karyawanId?: number; // Opsional
  pagination?: {
    page?: number; // Opsional
    limit?: number; // Opsional
    customOffset?: number; // Opsional
  };
  sort?: {
    sortBy: string;
    sortDirection: 'asc' | 'desc';
  };
  useCustomOffset?: boolean;
  flag?: string;
}

/**
 * Opsi untuk create/update yang bisa dipanggil bersarang antar-modul.
 *
 * `withGridPosition` hanya boleh true pada modul yang BENAR-BENAR dituju user
 * (yang gridnya perlu memfokuskan baris hasil simpan). Saat kas gantung
 * memanggil pengeluaran, dan pengeluaran memanggil jurnal umum, dua modul
 * terakhir tidak punya grid yang menunggu — menghitung posisi di sana hanya
 * memboroskan query berat dan hasilnya pun dibuang pemanggilnya.
 */
export interface WriteOptions {
  withGridPosition?: boolean;
}

export interface Ability {
  id: string;
  action: string;
  subject: string;
}
export interface UserRoleAbilities {
  roles: string[];
  abilities: Ability[];
}

export interface Menu {
  id: number;
  title: string;
  url: string;
  icon: string;
  isActive: boolean;
  order: number;
  parentId: number | null;
  items: Menu[];
}
import { z } from 'zod';

export const FindAllSchema = z
  .object({
    search: z.string().optional(),
    page: z.preprocess((val) => {
      const parsed = Number(val);
      // Clamp nilai tidak valid / < 1 ke 1 (selaras dengan `page || 1` di
      // controller). Mencegah 400 saat frontend sempat mengirim page=0, mis.
      // trik setCurrentPage(0) untuk memaksa refetch saat scroll.
      return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    }, z.number().int().min(1).default(1)),
    limit: z.preprocess((val) => {
      const parsed = Number(val);
      return isNaN(parsed) ? 10 : parsed; // Jika tidak valid, set limit ke 10
    }, z.number().int().default(10)),
    sortBy: z.string().optional(),
    isLookUp: z.string().optional(),
    exclude: z.string().optional(),
    exactMatch: z.string().optional(),
    sortDirection: z.enum(['asc', 'desc']).default('asc'),
  })
  .superRefine((val) => {
    console.log('val', val);
  });

export type FindAllDto = z.infer<typeof FindAllSchema>;
