// services/tableToServiceMap.ts

import { AkunpusatService } from '../akunpusat/akunpusat.service';
import { AlatbayarService } from '../alatbayar/alatbayar.service';
import { KasgantungdetailService } from '../kasgantungdetail/kasgantungdetail.service';
import { KasgantungheaderService } from '../kasgantungheader/kasgantungheader.service';
import { PengembaliankasgantungdetailService } from '../pengembaliankasgantungdetail/pengembaliankasgantungdetail.service';
import { PengembaliankasgantungheaderService } from '../pengembaliankasgantungheader/pengembaliankasgantungheader.service';

export const tableToServiceMap: Record<string, any> = {
  kasgantungheader: KasgantungheaderService,
  kasgantungdetail: KasgantungdetailService,
  akunpusat: AkunpusatService,
  alatbayar: AlatbayarService,
  pengembaliankasgantungheader: PengembaliankasgantungheaderService,
  pengembaliankasgantungdetail: PengembaliankasgantungdetailService,
};
// types/index.ts

export type ValidationCheck = {
  tableName: string;
  fieldName: string;
  fieldValue: any;
};

export type ValidationResult = {
  tableName: string;
  fieldName: string;
  fieldValue: any;
  status: 'success' | 'failed';
  message: string;
};
