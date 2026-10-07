// The warm-up before the suite. After a deployment the first request can take 4 or 5 seconds,
// because four Lambda functions start cold in a chain (lab-platform#17). The page of web then
// shows an error block, because web waits only 5 seconds for each API.
//
// The warm-up does not hide a real failure. It does two bounded polls:
//   1. GET /health of web, until it answers. It calls no other service.
//   2. GET / of web, until the page has no error block. This request wakes the whole chain.
// If the time runs out, the warm-up stops the run with the last reason. The tests do not retry blindly.

export interface WarmupOptions {
  readonly webUrl: string;
  // The time for the whole warm-up.
  readonly timeoutMs: number;
  // The pause between two tries.
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
  readonly pageTries: number;
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

export async function warmUp(options: WarmupOptions): Promise<WarmupResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? (() => undefined);
  const webUrl = options.webUrl.replace(/\/+$/, '');

  const started = now();
  const deadline = started + options.timeoutMs;

  async function request(path: string): Promise<Response> {
    return fetchFn(`${webUrl}${path}`, { signal: AbortSignal.timeout(options.requestTimeoutMs) });
  }

  const checkHealth: Attempt = async () => {
    let response: Response;
    try {
      response = await request('/health');
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

  const checkPage: Attempt = async () => {
    let response: Response;
    let html: string;
    try {
      response = await request('/');
      html = await response.text();
    } catch (error) {
      return describeFailure(error);
    }
    if (response.status !== 200) return `HTTP ${response.status}`;
    const shown = ERROR_BLOCKS.filter((id) => html.includes(`data-testid="${id}"`));
    return shown.length > 0 ? `the page shows ${shown.join(' and ')}` : undefined;
  };

  // Repeats a try until it works or the time runs out. Returns the number of tries.
  async function poll(label: string, attempt: Attempt): Promise<number> {
    for (let tries = 1; ; tries++) {
      const reason = await attempt();
      if (reason === undefined) return tries;
      log(`warm-up: ${label} try ${tries} failed: ${reason}`);
      if (now() + options.intervalMs >= deadline) {
        const seconds = Math.round(options.timeoutMs / 1000);
        throw new Error(`Warm-up failed. ${label} did not work in ${seconds} s after ${tries} tries. Last reason: ${reason}.`);
      }
      await sleep(options.intervalMs);
    }
  }

  const healthTries = await poll('/health', checkHealth);
  const pageTries = await poll('the page', checkPage);
  const elapsedMs = now() - started;
  log(`warm-up: ready after ${(elapsedMs / 1000).toFixed(1)} s (/health: ${healthTries} tries, page: ${pageTries} tries)`);
  return { healthTries, pageTries, elapsedMs };
}
