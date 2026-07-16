import { SetMetadata } from '@nestjs/common';

export const TIMEOUT_KEY = 'request-timeout';

export const SetRequestTimeout = (ms: number) => SetMetadata(TIMEOUT_KEY, ms);
