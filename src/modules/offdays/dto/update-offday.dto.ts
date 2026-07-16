import { Injectable } from '@nestjs/common';
import { parseDDMMYYYY } from 'src/utils/utils.service';
import { z } from 'zod';

export const UpdateOffdaySchema = z.object({
  date: z.preprocess((arg) => {
    if (typeof arg === 'string') {
      const parsedDate = parseDDMMYYYY(arg);
      if (parsedDate && !isNaN(parsedDate.getTime())) {
        return parsedDate;
      }
    }
    return undefined;
  }, z.date().optional()),
  keterangan: z
    .string()
    .min(1, { message: 'Keterangan is required' })
    .max(255)
    .optional(),
  modifiedby: z.string().nullable().optional(),
  statusaktif: z.string()
    .min(1, { message: 'statusaktif is required' })
    .optional(),
});
export type UpdateOffdayDto = z.infer<typeof UpdateOffdaySchema>;
