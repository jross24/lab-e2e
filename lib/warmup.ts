// The warm-up before the suite. After a deployment the first requests are slow, because four Lambda
// functions start cold in a chain (lab-platform#17). Web waits only 5 seconds for each API. If the chain
// needs more, the page shows an error block.
//
// The warm-up wakes the chain in the same order as the page does, and it measures the first call of each part:
//   1. GET /health of web, until it answers. It calls no other service. This is the only poll.
//   2. GET /products of the catalogue API and GET /profile of the account API, together and once. They wake
//      catalogue, account and core. Their times are the cold chain.
//   3. GET / of web, once. After step 2 the page has no cold function left.
// Step 2 and step 3 never retry. A retry would hide a release that is too slow. An error or an error block
// stops the run with the reason. A slow answer does not stop the run. The summary shows it as a warning
// when the slowest API call is above SLOW_CHAIN_MS.

// The limit that web gives to each API call. See the README of lab-web.
export const API_LIMIT_MS = 5_000;
// The first call of an API that takes longer than this is a warning. The margin to the limit is then below 1 s.
export const SLOW_CHAIN_MS = 4_000;

export interface WarmupOptions {
  readonly webUrl: string;
  readonly catalogueUrl: string;
  readonly accountUrl: string;
  // The time for the poll of /health.
  readonly timeoutMs: number;
  // The pause between two tries of /health.
  readonly intervalMs: number;
  // The limit for one request.
  readonly requestTimeoutMs: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface WarmupResult {
  readonly healthTries: number;
  // The time of the first call of each API, as the test runner sees it.
  readonly catalogueMs: number;
  readonly accountMs: number;
  // The time of the first page, after both APIs answered.
  readonly pageMs: number;
  readonly elapsedMs: number;
}

const ERROR_BLOCKS = ['catalogue-error', 'account-error'] as const;

// A try gives undefined when it works, or the reason why it does not.
type Attempt = () => Promise<string | undefined>;

// The message of a failed fetch is only "fetch failed". The cause has the reason, for example ENOTFOUND.
function describeFailure(error: unknown): string {
  const firstLine = (text: string) => text.split('\n')[0] ?? '';
  if (!(error instanceof Error)) return firstLine(String(error));
  const cause = error.cause instanceof Error ? firstLine(error.cause.message) : '';
  return cause ? `${firstLine(error.message)}: ${cause}` : firstLine(error.message);
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

// A limit is a round number. So it reads as 5 s and not 5.0 s.
function limit(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

// The time of the slowest first API call. This is the cold chain as web sees it, plus the network.
export function coldChainMs(result: Pick<WarmupResult, 'catalogueMs' | 'accountMs'>): number {
  return Math.max(result.catalogueMs, result.accountMs);
}

// The text of the warning, or undefined when the cold chain is fast enough. The summary and the log use it.
export function slowChainWarning(result: Pick<WarmupResult, 'catalogueMs' | 'accountMs'>): string | undefined {
  const slowest = coldChainMs(result);
  if (slowest <= SLOW_CHAIN_MS) return undefined;
  const name = result.catalogueMs >= result.accountMs ? 'catalogue' : 'account';
  return (
    `The first call of the ${name} API took ${seconds(slowest)}. This is above ${limit(SLOW_CHAIN_MS)}. ` +
    `Web waits ${limit(API_LIMIT_MS)} for each API, so a slower release shows an error block on the page. ` +
    'Find the service that got slower.'
  );
}

export async function warmUp(options: WarmupOptions): Promise<WarmupResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? (() => undefined);
  const clean = (url: string) => url.replace(/\/+$/, '');
  const webUrl = clean(options.webUrl);

  const started = now();
  const deadline = started + options.timeoutMs;

  function request(url: string): Promise<Response> {
    return fetchFn(url, { signal: AbortSignal.timeout(options.requestTimeoutMs) });
  }

  const checkHealth: Attempt = async () => {
    let response: Response;
    try {
      response = await request(`${webUrl}/health`);
    } catch (error) {
      return describeFailure(error);
    }
    if (response.status !== 200) return `HTTP ${response.status}`;
    try {
      const body: unknown = await response.json();
      const service = typeof body === 'object' && body !== null ? (body as { service?: unknown }).service : undefined;
      return service === 'web' ? undefined : 'the answer is not the health answer of web';
    } catch (error) {
      return describeFailure(error);
    }
  };

  // Repeats a try until it works or the time runs out. Returns the number of tries.
  async function poll(label: string, attempt: Attempt): Promise<number> {
    for (let tries = 1; ; tries++) {
      const reason = await attempt();
      if (reason === undefined) return tries;
      log(`warm-up: ${label} try ${tries} failed: ${reason}`);
      if (now() + options.intervalMs >= deadline) {
        throw new Error(`Warm-up failed. ${label} did not work in ${limit(options.timeoutMs)} after ${tries} tries. Last reason: ${reason}.`);
      }
      await sleep(options.intervalMs);
    }
  }

  // One GET request that is timed. It gives the time, and the reason when the call failed.
  async function timedCall(url: string): Promise<{ ms: number; failure?: string }> {
    const begin = now();
    try {
      const response = await request(url);
      await response.arrayBuffer();
      return { ms: now() - begin, ...(response.status === 200 ? {} : { failure: `HTTP ${response.status}` }) };
    } catch (error) {
      return { ms: now() - begin, failure: describeFailure(error) };
    }
  }

  const healthTries = await poll('/health', checkHealth);

  // Both APIs run together, as they do in the page. Each one has its own time.
  const [catalogue, account] = await Promise.all([
    timedCall(`${clean(options.catalogueUrl)}/products`),
    timedCall(`${clean(options.accountUrl)}/profile`),
  ]);
  const apiFailures: string[] = [];
  if (catalogue.failure !== undefined) {
    apiFailures.push(`the catalogue API (GET /products) failed after ${seconds(catalogue.ms)}: ${catalogue.failure}`);
  }
  if (account.failure !== undefined) {
    apiFailures.push(`the account API (GET /profile) failed after ${seconds(account.ms)}: ${account.failure}`);
  }
  if (apiFailures.length > 0) {
    throw new Error(`Warm-up failed. The first calls do not work, and the warm-up does not retry them. ${apiFailures.join('. ')}.`);
  }

  // The page comes last. It has no cold function left. The warm-up loads it once.
  const pageBegin = now();
  let pageFailure: string | undefined;
  try {
    const response = await request(`${webUrl}/`);
    const html = await response.text();
    if (response.status !== 200) {
      pageFailure = `HTTP ${response.status}`;
    } else {
      const shown = ERROR_BLOCKS.filter((id) => html.includes(`data-testid="${id}"`));
      if (shown.length > 0) pageFailure = `the page shows ${shown.join(' and ')}`;
    }
  } catch (error) {
    pageFailure = describeFailure(error);
  }
  const pageMs = now() - pageBegin;
  if (pageFailure !== undefined) {
    log(`warm-up: the page failed: ${pageFailure}`);
    throw new Error(
      'Warm-up failed. The page did not work after both APIs answered, and the warm-up does not retry it. ' +
        `Reason: ${pageFailure} after ${seconds(pageMs)}. ` +
        `The APIs took ${seconds(catalogue.ms)} (catalogue) and ${seconds(account.ms)} (account). ` +
        `Web waits ${limit(API_LIMIT_MS)} for each API.`,
    );
  }

  const result: WarmupResult = { healthTries, catalogueMs: catalogue.ms, accountMs: account.ms, pageMs, elapsedMs: now() - started };
  log(
    `warm-up: ready after ${seconds(result.elapsedMs)} (/health: ${healthTries} tries, catalogue ${seconds(result.catalogueMs)}, ` +
      `account ${seconds(result.accountMs)}, page ${seconds(result.pageMs)})`,
  );
  const warning = slowChainWarning(result);
  if (warning !== undefined) log(`warm-up: WARNING: ${warning}`);
  return result;
}
