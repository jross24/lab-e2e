import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readUrls } from './lib/config.ts';
import { RUN_DIR, WARMUP_FILE } from './lib/paths.ts';
import { warmUp } from './lib/warmup.ts';

// Warms the chain before the first test. See lib/warmup.ts for the reason.
// WARMUP_TIMEOUT_SECONDS changes the time limit. The default is 90 seconds.
const DEFAULT_TIMEOUT_SECONDS = 90;

export default async function globalSetup(): Promise<void> {
  const urls = readUrls();

  const seconds = Number(process.env['WARMUP_TIMEOUT_SECONDS'] ?? DEFAULT_TIMEOUT_SECONDS);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('WARMUP_TIMEOUT_SECONDS must be a number of seconds above 0.');
  }

  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(RUN_DIR, { recursive: true });

  const result = await warmUp({
    webUrl: urls.web,
    timeoutMs: seconds * 1000,
    intervalMs: 3_000,
    requestTimeoutMs: 15_000,
    log: (line) => console.log(line),
  });
  writeFileSync(WARMUP_FILE, JSON.stringify(result));
}
