// access.decorator.ts
import { SetMetadata } from '@nestjs/common';

export type Acos = { action: string; subject: string };

export const REQUIRE_ACOS_KEY = 'required-acos';

// Bisa 1 atau banyak ability (akan dievaluasi "semua harus terpenuhi" secara default)
export const RequireAcos = (...acos: Acos[]) =>
  SetMetadata(REQUIRE_ACOS_KEY, acos);
