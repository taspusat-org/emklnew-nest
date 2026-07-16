import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { TIMEOUT_KEY } from '../decorators/set-timeout.decorator';
import { requestContext, RequestStore } from '../context/request-context';

const DEFAULT_TIMEOUT_MS = 30000;

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    console.log(
      `${new Date().toISOString()} TimeoutInterceptor ${req.method} ${req.url}`,
    );

    const routeTimeout = this.reflector.getAllAndOverride<number>(TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const timeoutMs =
      routeTimeout ||
      Number(process.env.REQUEST_TIMEOUT_MS) ||
      DEFAULT_TIMEOUT_MS;

    const store: RequestStore = {
      abortController: new AbortController(),
      activeTransactions: new Set(),
    };

    return new Observable((subscriber) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;

        console.warn(
          `[TIMEOUT] Request timed out after ${timeoutMs}ms, rolling back ${store.activeTransactions.size} transaction(s)`,
        );

        store.abortController.abort();
        this.rollbackActiveTransactions(store);

        subscriber.error(
          new RequestTimeoutException(
            `Request timeout: server took longer than ${timeoutMs / 1000} seconds`,
          ),
        );
      }, timeoutMs);

      requestContext.run(store, () => {
        next.handle().subscribe({
          next: (val) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            subscriber.next(val);
            subscriber.complete();
          },
          error: (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            subscriber.error(err);
          },
          complete: () => {
            clearTimeout(timer);
          },
        });
      });

      return () => {
        clearTimeout(timer);
      };
    });
  }

  private rollbackActiveTransactions(store: RequestStore): void {
    if (store.activeTransactions.size === 0) return;

    for (const trx of store.activeTransactions) {
      try {
        if (typeof trx.isCompleted === 'function' && !trx.isCompleted()) {
          trx.rollback();
          console.warn(
            '[TIMEOUT] Transaction rolled back due to request timeout',
          );
        }
      } catch (e) {
        console.error('[TIMEOUT] Failed to rollback transaction:', e.message);
      }
    }
    store.activeTransactions.clear();
  }
}
