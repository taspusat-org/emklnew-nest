import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { SafeExceptionFilter } from './safe-exception.filter';

const FK_ERROR =
  'insert into "jurnalumumdetail" ("coa") values ($1) returning * - insert or update on table "jurnalumumdetail" violates foreign key constraint "FK_jurnalumumdetail_coa_akunpusat"';

function createHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('SafeExceptionFilter', () => {
  let filter: SafeExceptionFilter;

  beforeEach(() => {
    filter = new SafeExceptionFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  it('mengganti pesan SQL mentah tanpa mengubah status dan bentuk body', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: FK_ERROR,
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        'ISIAN COA BELUM DIPILIH ATAU TIDAK TERDAFTAR. SILAKAN PILIH DARI DAFTAR YANG TERSEDIA.',
      error: 'Internal Server Error',
    });
  });

  it('meneruskan pesan aturan bisnis apa adanya', () => {
    const { host, status, json } = createHost();

    filter.catch(new BadRequestException('KAS/BANK WAJIB DIPILIH.'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].message).toBe('KAS/BANK WAJIB DIPILIH.');
  });

  it('tidak menyentuh array issue zod pada respons 400', () => {
    const { host, json } = createHost();
    const issues = [{ path: ['tglbukti'], message: 'WAJIB DIISI' }];

    filter.catch(new BadRequestException(issues), host);

    expect(json.mock.calls[0][0].message).toBe(issues);
  });

  it('menjawab ZodError dengan bentuk yang sama seperti ZodFilter', () => {
    const { host, status, json } = createHost();
    const zodError = z
      .object({ nobukti: z.string() })
      .safeParse({}) as z.SafeParseError<unknown>;

    filter.catch(zodError.error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0]).toEqual({
      errors: zodError.error.errors,
      message: zodError.error.message,
      statusCode: HttpStatus.BAD_REQUEST,
    });
  });

  it('membalas error non-HTTP dengan pesan umum, bukan stack trace', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new TypeError("Cannot read properties of undefined (reading 'coa')"),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json.mock.calls[0][0].message).toBe(
      'TERJADI KESALAHAN PADA SISTEM. SILAKAN COBA LAGI ATAU HUBUNGI ADMINISTRATOR.',
    );
  });
});
