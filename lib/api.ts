import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Urls } from './config.ts';
import { VERSION_PATTERN } from './versions.ts';

// The answers of the public APIs. See the README of lab-svc-catalogue and lab-svc-account.
// Core is private. A GitHub runner cannot call it. Both services report its version and item count.

export interface CoreSummary {
  readonly version: string;
  readonly itemCount: number;
}

export interface HealthAnswer {
  readonly service: 'web';
  readonly version: string;
}

export interface CatalogueAnswer {
  readonly service: 'catalogue';
  readonly version: string;
  readonly core: CoreSummary;
  // discount is there only when the feature flag show-discounts is on. See lib/flags.ts.
  readonly products: readonly { id: string; name: string; price: number; discount?: unknown }[];
}

export interface AccountAnswer {
  readonly service: 'account';
  readonly version: string;
  readonly core: CoreSummary;
  readonly profile: { id: string; name: string; plan: string };
}

const REQUEST_TIMEOUT_MS = 15_000;

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0] ?? 'unknown error';
}

// One GET request. A network error and a body that is not JSON each get a message that names the target.
async function getJson(
  request: APIRequestContext,
  url: string,
  what: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  let response;
  try {
    response = await request.get(url, { timeout: REQUEST_TIMEOUT_MS, ...(headers ? { headers } : {}) });
  } catch (error) {
    throw new Error(`${what} is not reachable at ${url}: ${firstLine(error)}`);
  }
  try {
    return { status: response.status(), body: await response.json() };
  } catch {
    throw new Error(`${what} answered HTTP ${response.status()} and the body is not JSON (${url})`);
  }
}

const version = expect.stringMatching(VERSION_PATTERN);
const core = { version, itemCount: expect.any(Number) };

export async function fetchHealth(request: APIRequestContext, urls: Urls): Promise<HealthAnswer> {
  const { status, body } = await getJson(request, `${urls.web}/health`, 'web');
  expect(status, 'GET /health of web').toBe(200);
  expect(body, 'the body of GET /health').toMatchObject({ service: 'web', version });
  return body as HealthAnswer;
}

// The optional headers go with this one request only. The tests of the feature flag use it for the override.
export async function fetchCatalogue(request: APIRequestContext, urls: Urls, headers?: Record<string, string>): Promise<CatalogueAnswer> {
  const { status, body } = await getJson(request, `${urls.catalogue}/products`, 'the catalogue API', headers);
  expect(status, 'GET /products of the catalogue API').toBe(200);
  expect(body, 'the body of GET /products').toMatchObject({
    service: 'catalogue',
    version,
    core,
    products: expect.any(Array),
  });
  return body as CatalogueAnswer;
}

export async function fetchAccount(request: APIRequestContext, urls: Urls): Promise<AccountAnswer> {
  const { status, body } = await getJson(request, `${urls.account}/profile`, 'the account API');
  expect(status, 'GET /profile of the account API').toBe(200);
  expect(body, 'the body of GET /profile').toMatchObject({
    service: 'account',
    version,
    core,
    profile: { id: expect.any(String), name: expect.any(String), plan: expect.any(String) },
  });
  return body as AccountAnswer;
}
