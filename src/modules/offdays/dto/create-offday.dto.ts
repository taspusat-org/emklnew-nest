import { Injectable } from '@nestjs/common';
import { parseDDMMYYYY } from 'src/utils/utils.service';
import { z } from 'zod';

export const CreateOffdaySchema = z.object({
  tgl: z.preprocess(
    (arg) => {
      if (typeof arg === 'string') {
        const parsedDate = parseDDMMYYYY(arg);
        if (parsedDate && !isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
      }
      return undefined;
    },
    z.date({ required_error: 'Date is required' }),
  ),
  keterangan: z.string().min(1, { message: 'Keterangan is required' }).max(255),
  modifiedby: z.string().nullable().optional(),
  statusaktif: z.string().nullable().optional(),
});
export type CreateOffdayDto = z.infer<typeof CreateOffdaySchema>;
