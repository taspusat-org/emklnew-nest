/**
 * Burst request untuk uji timeout T12 (pool koneksi habis) — lihat
 * TIMEOUT_TEST_PLAN.md. Menembak N request GET /user paralel yang masing-masing
 * menahan satu transaksi selama <detik>, lalu melaporkan status & durasinya.
 *
 * node scripts/timeout-lab-burst.js <token> [jumlah=35] [detik=20] [baseUrl]
 *
 * Butuh TIMEOUT_LAB=1 di .env backend.
 */
const [, , token, countArg, secondsArg, baseUrlArg] = process.argv;

if (!token) {
  console.error(
    'Token wajib. Ambil dari DevTools > Network > header Authorization.',
  );
  process.exit(1);
}

const count = Number(countArg) || 35;
const seconds = Number(secondsArg) || 20;
const baseUrl = baseUrlArg || `http://localhost:${process.env.PORT || 5004}`;
const url = `${baseUrl}/user?page=1&limit=10&search=LABSLOW${seconds}`;

async function fire(index) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.replace(/^Bearer\s+/i, '')}` },
    });
    const body = await res.text();
    return {
      index,
      status: res.status,
      ms: Date.now() - started,
      note: res.ok ? '' : body.slice(0, 120),
    };
  } catch (error) {
    return {
      index,
      status: 'ERR',
      ms: Date.now() - started,
      note: error.message,
    };
  }
}

(async () => {
  console.log(`${count} request paralel -> ${url}`);
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => fire(i + 1)),
  );

  results
    .sort((a, b) => a.ms - b.ms)
    .forEach((r) =>
      console.log(
        `#${String(r.index).padStart(2)}  ${String(r.status).padEnd(4)}  ${String(r.ms).padStart(6)}ms  ${r.note}`,
      ),
    );

  const summary = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('\nringkasan status:', summary);
})();
