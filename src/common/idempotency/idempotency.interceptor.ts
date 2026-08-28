import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap } from 'rxjs';
import { IdempotencyService } from './idempotency.service';

/**
 * Membalas kiriman ulang (`Idempotency-Key` yang sama) dengan hasil kiriman
 * pertama. Sengaja di interceptor, bukan di controller: pipe validasi jalan
 * SESUDAH interceptor, jadi create yang diulang tidak keburu ditolak
 * "username sudah ada" oleh zod sebelum sempat dikenali sebagai kiriman ulang.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const idempotency = this.idempotencyService.prepare(req);
    if (!idempotency) return next.handle();

    return from(this.idempotencyService.findStored(idempotency)).pipe(
      switchMap((stored) => (stored ? of(stored) : next.handle())),
    );
  }
}
