import { AsyncLocalStorage } from 'async_hooks';

export interface RequestStore {
  abortController: AbortController;
  activeTransactions: Set<any>;
  // Menyala begitu sebuah transaksi mulai di-commit. Sejak titik itu 408 tidak
  // lagi jujur — datanya bisa saja sudah durable — jadi timeout tidak boleh
  // mengirimnya. Lihat timeout.interceptor.ts.
  commitAttempted?: boolean;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getRequestStore(): RequestStore | undefined {
  return requestContext.getStore();
}
