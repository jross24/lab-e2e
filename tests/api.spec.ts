import { expect, test } from '@playwright/test';
import { fetchAccount, fetchCatalogue } from '../lib/api.ts';
import { readUrls } from '../lib/config.ts';

// The shape of each answer is checked in lib/api.ts. These tests add the checks of the data.
// The core API is private, so core is tested here through the answers of the two public APIs.

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
