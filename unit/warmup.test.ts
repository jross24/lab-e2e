import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { warmUp } from '../lib/warmup.ts';
import type { WarmupOptions } from '../lib/warmup.ts';

type Answer = { status: number; body: string } | Error;

const HEALTH_OK: Answer = { status: 200, body: JSON.stringify({ service: 'web', version: '0.1.0' }) };
const PAGE_OK: Answer = { status: 200, body: '<main><li data-testid="product">x</li></main>' };
const PAGE_CATALOGUE_ERROR: Answer = {
  status: 200,
  body: '<p class="error" data-testid="catalogue-error">The catalogue service is not available: the request timed out.</p>',
};
const PAGE_ACCOUNT_ERROR: Answer = { status: 200, body: '<p data-testid="account-error">x</p>' };

// A fake network and a fake clock. A pause moves the clock. A request takes 100 ms.
function harness(answers: { health: Answer[]; page: Answer[] }) {
  let clock = 1_000_000;
  const calls: string[] = [];
  const lines: string[] = [];
  const queue = { '/health': [...answers.health], '/': [...answers.page] };

  const fetch = async (url: string | URL | Request): Promise<Response> => {
    const path = new URL(String(url)).pathname as '/health' | '/';
    calls.push(path);
    clock += 100;
    // The last answer repeats when the list runs out.
    const list = queue[path];
    const next = list.length > 1 ? list.shift() : list[0];
    if (next === undefined) throw new Error('no answer defined');
    if (next instanceof Error) throw next;
    return new Response(next.body, { status: next.status });
  };

  const options: WarmupOptions = {
    webUrl: 'https://web.example.test',
    timeoutMs: 30_000,
    intervalMs: 2_000,
    requestTimeoutMs: 5_000,
    fetch: fetch as typeof globalThis.fetch,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: (line) => lines.push(line),
  };
  return { options, calls, lines };
}

describe('warmUp', () => {
  it('needs one try of each when the chain is warm', async () => {
    const { options, calls } = harness({ health: [HEALTH_OK], page: [PAGE_OK] });
    const result = await warmUp(options);
    assert.deepEqual(calls, ['/health', '/']);
    assert.equal(result.healthTries, 1);
    assert.equal(result.pageTries, 1);
  });

  it('polls /health first and then the page', async () => {
    const { options, calls } = harness({
      health: [{ status: 502, body: '' }, HEALTH_OK],
      page: [PAGE_CATALOGUE_ERROR, PAGE_ACCOUNT_ERROR, PAGE_OK],
    });
    const result = await warmUp(options);
    assert.deepEqual(calls, ['/health', '/health', '/', '/', '/']);
    assert.equal(result.healthTries, 2);
    assert.equal(result.pageTries, 3);
  });

  it('counts a network error as a failed try', async () => {
    const { options } = harness({ health: [new Error('connect ETIMEDOUT'), HEALTH_OK], page: [PAGE_OK] });
    const result = await warmUp(options);
    assert.equal(result.healthTries, 2);
  });

  it('puts the cause of a failed fetch in the message', async () => {
    const failure = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND web.example.test') });
    const { options } = harness({ health: [failure], page: [PAGE_OK] });
    await assert.rejects(warmUp(options), /fetch failed: getaddrinfo ENOTFOUND web\.example\.test/);
  });

  it('requires service "web" in the answer of /health', async () => {
    const wrong: Answer = { status: 200, body: JSON.stringify({ service: 'other', version: '1.0.0' }) };
    const { options } = harness({ health: [wrong], page: [PAGE_OK] });
    await assert.rejects(warmUp(options), /\/health/);
  });

  it('stops with the name of the error block when the page never becomes clean', async () => {
    const { options, calls, lines } = harness({ health: [HEALTH_OK], page: [PAGE_CATALOGUE_ERROR] });
    await assert.rejects(warmUp(options), (error: Error) => {
      assert.match(error.message, /Warm-up failed/);
      assert.match(error.message, /30 s/);
      assert.match(error.message, /catalogue-error/);
      return true;
    });
    // 2 s pause + 0.1 s request per try: a bounded number of tries, not an endless loop.
    assert.ok(calls.length > 5 && calls.length < 30, `tries: ${calls.length}`);
    assert.ok(lines.some((line) => line.includes('catalogue-error')));
  });

  it('stops when /health never answers', async () => {
    const { options, calls } = harness({ health: [{ status: 503, body: '' }], page: [PAGE_OK] });
    await assert.rejects(warmUp(options), /Warm-up failed.*\/health.*HTTP 503/s);
    assert.ok(!calls.includes('/'), 'the page must not be loaded before /health works');
  });

  it('keeps polling after an HTTP 502 page until the limit', async () => {
    const { options } = harness({ health: [HEALTH_OK], page: [{ status: 502, body: '<h1>502 Bad gateway</h1>' }] });
    await assert.rejects(warmUp(options), /HTTP 502/);
  });

  it('logs one line for each failed try and one for the result', async () => {
    const { options, lines } = harness({ health: [HEALTH_OK], page: [PAGE_CATALOGUE_ERROR, PAGE_OK] });
    await warmUp(options);
    assert.equal(lines.filter((line) => line.includes('try 1') && line.includes('catalogue-error')).length, 1);
    assert.ok(lines.at(-1)?.includes('ready'));
  });
});
