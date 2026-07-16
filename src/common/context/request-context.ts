import { AsyncLocalStorage } from 'async_hooks';

export interface RequestStore {
  abortController: AbortController;
  activeTransactions: Set<any>;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

export function getRequestStore(): RequestStore | undefined {
  return requestContext.getStore();
}
