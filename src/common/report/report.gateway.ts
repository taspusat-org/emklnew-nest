import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ReportJobStore } from './report-job.store';

export interface ReportProgressPayload {
  step: string;
  percent: number;
  status: 'processing' | 'done' | 'error';
  downloadUrl?: string;
  error?: string;
}

/**
 * Channel progres render PDF. Client subscribe ke room ber-nama jobId lalu
 * menerima event `report:progress` sampai status `done`/`error`.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/report',
  cors: {
    origin: (origin, callback) => callback(null, true),
    credentials: true,
  },
})
export class ReportGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReportGateway.name);

  constructor(private readonly jobStore: ReportJobStore) {}

  afterInit() {
    this.logger.log('ReportGateway initialized (namespace: /report)');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`[connect] client=${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`[disconnect] client=${client.id}`);
  }

  /**
   * Client mengirim event 'join' dengan jobId untuk masuk ke room-nya.
   *
   * Render Stimulsoft memblokir event loop, jadi client bisa saja sempat
   * ping-timeout lalu reconnect di tengah proses. Karena client selalu
   * mengirim 'join' lagi setiap `connect`, catch-up di bawah memastikan
   * state akhir tetap sampai walau event aslinya terlewat.
   */
  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() jobId: string,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!jobId) {
      this.logger.warn(`[join] client=${client.id} mengirim jobId kosong`);
      return;
    }

    client.join(jobId);
    this.logger.debug(`[join] client=${client.id} → room=${jobId}`);

    const job = this.jobStore.get(jobId);
    if (!job || job.status === 'processing') return;

    const berkas = job.kind === 'excel' ? 'Excel' : 'PDF';

    if (job.status === 'done') {
      this.logger.log(
        `[join] catch-up → client=${client.id} telat join, job=${jobId} sudah done`,
      );
      client.emit('report:progress', {
        jobId,
        step: `${berkas} siap diunduh.`,
        percent: 100,
        status: 'done',
        downloadUrl: `/report/download/${jobId}`,
      });
    } else {
      this.logger.log(
        `[join] catch-up → client=${client.id} telat join, job=${jobId} error`,
      );
      client.emit('report:progress', {
        jobId,
        step: `Gagal generate ${berkas}.`,
        percent: 100,
        status: 'error',
        error: job.error,
      });
    }
  }

  emitProgress(jobId: string, payload: ReportProgressPayload): void {
    if (!this.server || !this.server.adapter) {
      this.logger.error(
        `[emit] WebSocket server belum siap, event dilewati: jobId=${jobId}, status=${payload.status}`,
      );
      return;
    }

    const roomSize =
      (this.server.adapter as any)?.rooms?.get(jobId)?.size ?? 0;

    if (roomSize === 0) {
      this.logger.warn(
        `[emit] room=${jobId} kosong — event '${payload.status}' (${payload.percent}%) tidak ada penerima`,
      );
    }

    this.server.to(jobId).emit('report:progress', { jobId, ...payload });
  }
}
