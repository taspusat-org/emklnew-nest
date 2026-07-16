// acl.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { dbMssql } from 'src/common/utils/db';
import { UtilsService } from 'src/utils/utils.service';
import { Acos, REQUIRE_ACOS_KEY } from './access.decorator';

type Req = {
  method: string;
  params?: Record<string, any>;
  route?: { path?: string };
  user?: any;
};

@Injectable()
export class AclGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly utilsService: UtilsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Req>();
    const userId =
      request.user?.user?.id ?? request.user?.id ?? request.user?.sub; // sesuaikan dengan payload JWT Anda

    if (!userId) {
      // Seharusnya AuthGuard sudah memverifikasi ini
      throw new ForbiddenException('Missing user identity');
    }

    // 1) Ambil abilities user
    const { abilities } = await this.utilsService.fetchUserRolesAndAbilities(
      String(userId),
      dbMssql,
    );

    // 2) Tentukan required abilities
    const required = this.reflector.getAllAndOverride<Acos[]>(
      REQUIRE_ACOS_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? [this.deriveAbility(context)];
    console.log('required', required);
    // 3) Cek semuanya harus terpenuhi (AND). Ubah ke "some" bila ingin OR.
    const ok = required.every((need) =>
      abilities.some((have) => this.matchAbility(have, need, request)),
    );

    if (!ok) {
      const label = required.map((r) => `${r.action}:${r.subject}`).join(' & ');
      throw new ForbiddenException(
        `You don't have permission (${label}) to access this resource`,
      );
    }

    // opsional: tempel abilities ke request utk dipakai di handler/interceptor/log
    (request as any).abilities = abilities;
    return true;
  }

  private matchAbility(
    have: { action: string; subject: string },
    need: Acos,
    req: Req,
  ): boolean {
    const norm = (s?: string) => (s ?? '').toLowerCase();
    const actionEq =
      this.normalizeAction(have.action) === this.normalizeAction(need.action) ||
      have.action === '*' ||
      need.action === '*';
    const subjectEq =
      norm(have.subject) === norm(need.subject) ||
      have.subject === '*' ||
      need.subject === '*';

    return actionEq && subjectEq;
  }

  // Pemetaan sinonim action agar fleksibel dengan data di tabel acos
  private normalizeAction(action: string): string {
    const a = (action || '').toUpperCase();
    if (a === 'INDEX') return 'GET';
    if (a === 'LIST') return 'GET';
    if (a === 'SHOW') return 'GET';
    if (a === 'STORE' || a === 'CREATE' || a === 'POST') return 'POST';
    if (a === 'PUT' || a === 'PATCH' || a === 'UPDATE') return 'UPDATE';
    if (a === 'DELETE' || a === 'DESTROY') return 'DELETE';
    // GET-ALL, GET, POST, UPDATE, DELETE tetap
    return a;
  }

  // Mode otomatis: turunkan {action, subject} dari method + controller + param :id
  private deriveAbility(context: ExecutionContext): Acos {
    const req = context.switchToHttp().getRequest<Req>();
    const httpMethod = (req.method || 'GET').toUpperCase();
    const handlerHasId =
      Boolean(req?.params?.id) || (req?.route?.path ?? '').includes(':id');

    let action: string;
    switch (httpMethod) {
      case 'GET':
        action = handlerHasId ? 'GET' : 'GET';
        break;
      case 'POST':
        action = 'POST';
        break;
      case 'PUT':
      case 'PATCH':
        action = 'UPDATE';
        break;
      case 'DELETE':
        action = 'DELETE';
        break;
      default:
        action = httpMethod;
    }

    const clsName = context.getClass().name || 'unknown';
    const subject = this.toSubjectName(clsName);
    return { action, subject };
  }

  // Contoh normalisasi: TypeAkuntansiController -> "typeakuntansi" (atau ganti ke "type-akuntansi")
  private toSubjectName(controllerName: string): string {
    const base = controllerName.replace(/Controller$/i, '');
    // Sesuaikan dengan data di kolom acos.class milik Anda:
    // return base.replace(/[A-Z]/g, (m, i) => (i ? '-' : '') + m.toLowerCase());
    return base.toLowerCase();
  }
}
