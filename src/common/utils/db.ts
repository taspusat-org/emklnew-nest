import knex from 'knex';
import knexConfig from 'src/knexfile';
import { getRequestStore } from '../context/request-context';

function wrapTransaction(trx: any): any {
  return new Proxy(trx, {
    apply(target, thisArg, argsList) {
      return Reflect.apply(target, thisArg, argsList);
    },
    get(target, prop, receiver) {
      if (prop === 'commit') {
        return async function (...args: any[]) {
          if (typeof target.isCompleted === 'function' && target.isCompleted()) {
            return;
          }
          return target.commit.apply(target, args);
        };
      }
      if (prop === 'rollback') {
        return async function (...args: any[]) {
          if (typeof target.isCompleted === 'function' && target.isCompleted()) {
            return;
          }
          return target.rollback.apply(target, args);
        };
      }
      if (prop === 'isCompleted') {
        return target.isCompleted.bind(target);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

function wrapWithTimeout(originalDb: any): any {
  return new Proxy(originalDb, {
    apply(target, thisArg, argsList) {
      return Reflect.apply(target, thisArg, argsList);
    },
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return function (...args: any[]) {
          const store = getRequestStore();

          if (!store) return target.transaction(...args);

          if (typeof args[0] === 'function') {
            if (store.abortController.signal.aborted) {
              return Promise.reject(new Error('Request already timed out'));
            }
            return target.transaction(...args);
          }

          if (store.abortController.signal.aborted) {
            return Promise.reject(new Error('Request already timed out'));
          }

          return target.transaction(...args).then((trx: any) => {
            store.activeTransactions.add(trx);

            if (store.abortController.signal.aborted) {
              try {
                trx.rollback();
              } catch {}
              throw new Error('Request timed out during transaction creation');
            }

            store.abortController.signal.addEventListener(
              'abort',
              () => {
                try {
                  if (
                    typeof trx.isCompleted === 'function' &&
                    !trx.isCompleted()
                  ) {
                    trx.rollback();
                    console.warn(
                      '[TIMEOUT] Transaction auto-rolled back via abort signal',
                    );
                  }
                } catch {}
              },
              { once: true },
            );

            return wrapTransaction(trx);
          });
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

const dbMssql = wrapWithTimeout(knex(knexConfig.development));
const dbMdnEmkl = wrapWithTimeout(knex(knexConfig.medanEmkl));
const dbMdnTruck = wrapWithTimeout(knex(knexConfig.medanTrucking));
const dbjktEmkl = wrapWithTimeout(knex(knexConfig.jktEmkl));
const dbjktTrucking = wrapWithTimeout(knex(knexConfig.jktTrucking));
const dbsbyEmkl = wrapWithTimeout(knex(knexConfig.sbyEmkl));
const dbsbyTrucking = wrapWithTimeout(knex(knexConfig.sbyTrucking));
const dbsmgEmkl = wrapWithTimeout(knex(knexConfig.smgEmkl));
const dbmksEmkl = wrapWithTimeout(knex(knexConfig.mksEmkl));
const dbmksTrucking = wrapWithTimeout(knex(knexConfig.mksTrucking));
const dbbtgEmkl = wrapWithTimeout(knex(knexConfig.btgEmkl));
const dbMysqlTes = wrapWithTimeout(knex(knexConfig.mysqltest));
const dbBunga = wrapWithTimeout(knex(knexConfig.dbBunga));
const dbHr = wrapWithTimeout(knex(knexConfig.dbHr));

export async function createTransaction(
  db: any,
  retries = 3,
  delayMs = 50,
): Promise<any> {
  while (retries > 0) {
    try {
      return await db.transaction();
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.error(
          '[TRANSACTION ERROR] Failed after all retries:',
          error.message,
        );
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export {
  dbMssql,
  dbMdnEmkl,
  dbMdnTruck,
  dbjktEmkl,
  dbjktTrucking,
  dbsbyEmkl,
  dbsbyTrucking,
  dbsmgEmkl,
  dbmksEmkl,
  dbmksTrucking,
  dbbtgEmkl,
  dbMysqlTes,
  dbBunga,
  dbHr,
};
