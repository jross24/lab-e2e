import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_LIMIT_MS, SLOW_CHAIN_MS, coldChainMs, slowChainWarning, warmUp } from '../lib/warmup.ts';
import type { WarmupOptions, WarmupResult } from '../lib/warmup.ts';

type Ok = { status: number; body: string; ms?: number };
type Answer = Ok | Error;
type Path = '/health' | '/products' | '/profile' | '/';

const HEALTH_OK: Ok = { status: 200, body: JSON.stringify({ service: 'web', version: '0.1.0' }) };
const PRODUCTS_OK: Ok = { status: 200, body: JSON.stringify({ service: 'catalogue', products: [] }) };
const PROFILE_OK: Ok = { status: 200, body: JSON.stringify({ service: 'account', profile: {} }) };
const PAGE_OK: Ok = { status: 200, body: '<main><li data-testid="product">x</li></main>' };
const PAGE_CATALOGUE_ERROR: Ok = {
  status: 200,
  body: '<p class="error" data-testid="catalogue-error">The catalogue service is not available: the request timed out.</p>',
};

type Answers = Partial<Record<Path, Answer[]>>;

// A fake network on a virtual clock. A request or a pause waits for a time. The driver moves the clock to the
// earliest wake-up time when no other code can run. So two requests that run together take their own time.
function harness(answers: Answers = {}) {
  let clock = 1_000_000;
  const timers: { at: number; wake: () => void }[] = [];
  const calls: string[] = [];
  const lines: string[] = [];
  const queue: Record<Path, Answer[]> = {
    '/health': [HEALTH_OK],
    '/products': [PRODUCTS_OK],
    '/profile': [PROFILE_OK],
    '/': [PAGE_OK],
    ...answers,
  };

  const wait = (ms: number) => new Promise<void>((resolve) => timers.push({ at: clock + ms, wake: resolve }));

  const fetch = async (url: string | URL | Request): Promise<Response> => {
    const path = new URL(String(url)).pathname as Path;
    calls.push(path);
    const list = queue[path];
    // The last answer repeats when the list runs out.
    const next = list.length > 1 ? list.shift() : list[0];
    if (next === undefined) throw new Error('no answer defined');
    await wait(next instanceof Error ? 100 : (next.ms ?? 100));
    if (next instanceof Error) throw next;
    return new Response(next.body, { status: next.status });
  };

  const options: WarmupOptions = {
    webUrl: 'https://web.example.test',
    catalogueUrl: 'https://catalogue.example.test',
    accountUrl: 'https://account.example.test',
    timeoutMs: 30_000,
    intervalMs: 2_000,
    requestTimeoutMs: 5_000,
    fetch: fetch as typeof globalThis.fetch,
    now: () => clock,
    sleep: wait,
    log: (line) => lines.push(line),
  };

  // Runs the warm-up and moves the clock until it ends.
  async function run(overrides: Partial<WarmupOptions> = {}): Promise<WarmupResult> {
    let ended = false;
    const running = warmUp({ ...options, ...overrides }).finally(() => {
      ended = true;
    });
    running.catch(() => undefined);
    for (let steps = 0; !ended; steps++) {
      if (steps > 10_000) throw new Error('the warm-up does not end');
      await new Promise<void>((resolve) => setImmediate(resolve));
      timers.sort((a, b) => a.at - b.at);
      const next = timers.shift();
      if (next) {
        clock = Math.max(clock, next.at);
        next.wake();
      }
    }
    return running;
  }
  return { run, calls, lines };
}

describe('warmUp', () => {
  it('calls /health, both APIs and the page once, in this order', async () => {
    const { run, calls } = harness();
    const result = await run();
    assert.equal(calls[0], '/health');
    assert.deepEqual([...calls.slice(1, 3)].sort(), ['/products', '/profile']);
    assert.equal(calls[3], '/');
    assert.equal(calls.length, 4);
    assert.equal(result.healthTries, 1);
  });

  it('does not call the APIs before /health works', async () => {
    const { run, calls } = harness({ '/health': [{ status: 503, body: '' }] });
    await assert.rejects(run(), /Warm-up failed.*\/health.*HTTP 503/s);
    assert.ok(!calls.includes('/products') && !calls.includes('/profile') && !calls.includes('/'));
  });

  it('records the time of the first call of each API and of the page', async () => {
    const { run } = harness({
      '/products': [{ ...PRODUCTS_OK, ms: 2_400 }],
      '/profile': [{ ...PROFILE_OK, ms: 1_900 }],
      '/': [{ ...PAGE_OK, ms: 300 }],
    });
    const result = await run();
    // Both APIs start together, so each one keeps its own time.
    assert.equal(result.catalogueMs, 2_400);
    assert.equal(result.accountMs, 1_900);
    assert.equal(result.pageMs, 300);
    assert.equal(coldChainMs(result), 2_400);
    // /health 100 ms, then the slower API, then the page.
    assert.equal(result.elapsedMs, 100 + 2_400 + 300);
  });

  it('does not fail for a slow answer. The summary warns instead', async () => {
    const { run } = harness({ '/products': [{ ...PRODUCTS_OK, ms: 4_500 }] });
    const result = await run({ requestTimeoutMs: 15_000 });
    assert.ok(coldChainMs(result) > SLOW_CHAIN_MS);
  });

  it('polls /health until it answers', async () => {
    const { run, calls } = harness({ '/health': [{ status: 502, body: '' }, HEALTH_OK] });
    const result = await run();
    assert.equal(result.healthTries, 2);
    assert.deepEqual(calls.slice(0, 2), ['/health', '/health']);
  });

  it('counts a network error of /health as a failed try', async () => {
    const { run } = harness({ '/health': [new Error('connect ETIMEDOUT'), HEALTH_OK] });
    const result = await run();
    assert.equal(result.healthTries, 2);
  });

  it('puts the cause of a failed fetch in the message', async () => {
    const failure = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND web.example.test') });
    const { run } = harness({ '/health': [failure] });
    await assert.rejects(run(), /fetch failed: getaddrinfo ENOTFOUND web\.example\.test/);
  });

  it('requires service "web" in the answer of /health', async () => {
    const wrong: Answer = { status: 200, body: JSON.stringify({ service: 'other', version: '1.0.0' }) };
    const { run } = harness({ '/health': [wrong] });
    await assert.rejects(run(), /\/health/);
  });

  it('stops with the time of /health when it never answers', async () => {
    const { run, calls } = harness({ '/health': [{ status: 503, body: '' }] });
    await assert.rejects(run(), (error: Error) => {
      assert.match(error.message, /30 s/);
      return true;
    });
    // 2 s pause + 0.1 s request per try: a bounded number of tries, not an endless loop.
    assert.ok(calls.length > 5 && calls.length < 30, `tries: ${calls.length}`);
  });

  it('stops at once when the catalogue API answers with an error. It does not retry', async () => {
    const { run, calls } = harness({ '/products': [{ status: 502, body: 'Bad gateway' }, PRODUCTS_OK] });
    await assert.rejects(run(), (error: Error) => {
      assert.match(error.message, /Warm-up failed/);
      assert.match(error.message, /catalogue API/);
      assert.match(error.message, /GET \/products/);
      assert.match(error.message, /HTTP 502/);
      return true;
    });
    assert.equal(calls.filter((path) => path === '/products').length, 1);
    assert.ok(!calls.includes('/'), 'the page must not load after a failed API');
  });

  it('stops at once when the account API does not answer', async () => {
    const failure = new TypeError('fetch failed', { cause: new Error('connect ECONNRESET') });
    const { run, calls } = harness({ '/profile': [failure] });
    await assert.rejects(run(), /account API.*GET \/profile.*fetch failed: connect ECONNRESET/s);
    assert.equal(calls.filter((path) => path === '/profile').length, 1);
  });

  it('names both APIs when both fail', async () => {
    const { run } = harness({ '/products': [{ status: 500, body: '' }], '/profile': [{ status: 503, body: '' }] });
    await assert.rejects(run(), /catalogue API.*HTTP 500.*account API.*HTTP 503/s);
  });

  it('stops at once when the page shows an error block. It does not load the page again', async () => {
    const { run, calls, lines } = harness({ '/': [PAGE_CATALOGUE_ERROR, PAGE_OK] });
    await assert.rejects(run(), (error: Error) => {
      assert.match(error.message, /Warm-up failed/);
      assert.match(error.message, /catalogue-error/);
      assert.match(error.message, /5 s/);
      return true;
    });
    assert.equal(calls.filter((path) => path === '/').length, 1);
    assert.ok(lines.some((line) => line.includes('catalogue-error')));
  });

  it('stops at once when the page answers HTTP 502', async () => {
    const { run, calls } = harness({ '/': [{ status: 502, body: '<h1>502 Bad gateway</h1>' }] });
    await assert.rejects(run(), /The page.*HTTP 502/s);
    assert.equal(calls.filter((path) => path === '/').length, 1);
  });

  it('logs one line with the first calls and the slowest', async () => {
    const { run, lines } = harness({ '/products': [{ ...PRODUCTS_OK, ms: 2_400 }] });
    await run();
    const last = lines.at(-1) ?? '';
    assert.match(last, /ready/);
    assert.match(last, /catalogue 2\.4 s/);
    assert.match(last, /account/);
    assert.match(last, /page/);
  });
});

describe('slowChainWarning', () => {
  const result = (catalogueMs: number, accountMs: number): WarmupResult => ({
    healthTries: 1,
    catalogueMs,
    accountMs,
    pageMs: 300,
    elapsedMs: catalogueMs + 600,
  });

  it('uses the stated limits: 4 s to warn, 5 s for each API', () => {
    assert.equal(SLOW_CHAIN_MS, 4_000);
    assert.equal(API_LIMIT_MS, 5_000);
  });

  it('gives no warning for the cold chain of 512 MB, which is below 3 s', () => {
    assert.equal(slowChainWarning(result(2_400, 1_900)), undefined);
  });

  it('gives no warning at exactly the limit', () => {
    assert.equal(slowChainWarning(result(SLOW_CHAIN_MS, 1_000)), undefined);
  });

  it('warns above the limit and names the slow API, the time and the limit of web', () => {
    const text = slowChainWarning(result(1_000, 4_300));
    assert.ok(text !== undefined);
    assert.match(text, /account API/);
    assert.match(text, /4\.3 s/);
    assert.match(text, /4 s/);
    assert.match(text, /5 s/);
  });

  it('names the catalogue API when it is the slower one', () => {
    assert.match(slowChainWarning(result(4_600, 1_000)) ?? '', /catalogue API/);
  });
});
