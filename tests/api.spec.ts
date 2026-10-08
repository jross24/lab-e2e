import { expect, test } from '@playwright/test';
import { fetchAccount, fetchCatalogue, fetchHealth } from '../lib/api.ts';
import { readUrls } from '../lib/config.ts';

// The shape of each answer is checked in lib/api.ts. The first test only calls the three public APIs.
// It is part of the smoke subset. The two other tests add the checks of the data. They run in the full suite only.
// The core API is private, so core is tested here through the answers of the two public APIs.

test('each public API answers with the documented shape', { tag: '@smoke' }, async ({ request }) => {
  const urls = readUrls();
  await Promise.all([fetchHealth(request, urls), fetchCatalogue(request, urls), fetchAccount(request, urls)]);
});

test('the catalogue API answers with products and the core summary', async ({ request }) => {
  const answer = await fetchCatalogue(request, readUrls());
  expect(answer.core.itemCount, 'the number of items that core returned').toBeGreaterThan(0);
  expect(answer.products.length, 'the number of products').toBeGreaterThan(0);
  expect(answer.products[0], 'the first product').toMatchObject({
    id: expect.any(String),
    name: expect.any(String),
    price: expect.any(Number),
  });
});

test('the account API answers with a profile and the core summary', async ({ request }) => {
  const answer = await fetchAccount(request, readUrls());
  expect(answer.core.itemCount, 'the number of items that core returned').toBeGreaterThan(0);
});
