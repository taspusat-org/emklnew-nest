import { Logger } from '@nestjs/common';

type LabStage = 'slow' | 'cache' | 'after';

// Token uji timeout. Ditulis di data yang dikirim user (nama, username, kata
// kunci pencarian) supaya skenario bisa dipicu langsung dari layar, tanpa
// header/parameter khusus. Lihat TIMEOUT_TEST_PLAN.md.
const TOKENS: Record<LabStage, RegExp> = {
  slow: /LABSLOW(\d{1,3})/i,
  cache: /LABCACHE(\d{1,3})/i,
  // Menahan respons SETELAH commit: dari sisi browser sama persis dengan
  // jaringan user yang lambat mengantar balasan — datanya sudah masuk.
  after: /LABAFTER(\d{1,3})/i,
};

const MAX_DELAY_SECONDS = 300;
const logger = new Logger('TimeoutLab');

export const isTimeoutLabEnabled = (): boolean =>
  process.env.TIMEOUT_LAB === '1';

/**
 * Menahan proses selama <detik> bila salah satu `values` mengandung token uji
 * (`LABSLOW30`, `LABCACHE30`). No-op selama `TIMEOUT_LAB=1` tidak diset, jadi
 * aman ikut terbawa ke server lain — tapi jangan pernah aktifkan di produksi.
 *
 * Sengaja TIDAK ikut berhenti saat abort signal menyala: query lambat sungguhan
 * juga tidak bisa dibatalkan dari sisi Node, dan justru itu yang diuji.
 */
export async function labDelay(
  stage: LabStage,
  ...values: unknown[]
): Promise<void> {
  const match = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.match(TOKENS[stage]))
    .find((result): result is RegExpMatchArray => result !== null);
  if (!match) return;

  // Token terbaca tapi lab mati = proses ini start sebelum .env diubah.
  if (!isTimeoutLabEnabled()) {
    logger.warn(
      `token ${match[0]} terdeteksi tapi TIMEOUT_LAB belum aktif di proses ini — restart backend setelah mengubah .env`,
    );
    return;
  }

  const seconds = Math.min(Number(match[1]), MAX_DELAY_SECONDS);
  if (seconds <= 0) return;

  logger.warn(`[${stage}] menahan proses ${seconds}s (token ${match[0]})`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  logger.warn(`[${stage}] tahan ${seconds}s selesai, proses dilanjutkan`);
}
