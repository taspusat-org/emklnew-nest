// inject-method.pipe.ts
import { Injectable, PipeTransform, ArgumentMetadata } from '@nestjs/common';

type Mode = 'create' | 'update';

@Injectable()
export class InjectMethodPipe implements PipeTransform {
  constructor(private readonly mode: Mode) {}

  transform(value: any, _metadata: ArgumentMetadata) {
    // jangan timpa method bila client sudah kirim, tapi biasanya kita yang set
    return { method: this.mode, ...value };
  }
}
