import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { fetchCatalogue } from '../lib/api.ts';
import { readUrls } from '../lib/config.ts';
import {
  FLAG_ANNOTATION,
  FLAG_NAME,
  discountProblems,
  expectedDiscountCount,
  oppositeOverrideHeaders,
  oppositeState,
  overrideSkipReason,
  readDeclaredState,
} from '../lib/flags.ts';
import type { FlagValue } from '../lib/flags.ts';

// The feature flag show-discounts has a declared state in each environment: on or off. The flag file of lab-flags
// declares it, and the suite action reads it from the SSM parameter /lab/flags/state/show-discounts. These tests follow
// that state. They do not hard-code it, so a release that turns the flag on for an environment needs no change here.
//
// In Test only, the header x-lab-flags sets the flag for one request. There the suite also tests the OPPOSITE of the
// declared state through the header. Staging and Production ignore the header. See lib/flags.ts and the README.
//
// Each test carries an annotation of the type flag-state. The summary reads it for its flag line.

// The catalogue sends what the state means: a numeric discount for each product when on, no discount field when off.
async function expectCatalogue(request: APIRequestContext, state: FlagValue, headers?: Record<string, string>): Promise<void> {
  const { products } = await fetchCatalogue(request, readUrls(), headers);
  expect(products.length, 'the number of products').toBeGreaterThan(0);
  expect(discountProblems(products, state), `products that do not match the state ${state} of ${FLAG_NAME}`).toEqual([]);
}

// The page shows what the state means: one discount for each product when on, none when off.
// With expectedProducts, the page must list that many products. Without it, the page must list at least one.
async function expectPage(page: Page, state: FlagValue, expectedProducts?: number): Promise<void> {
  const response = await page.goto(readUrls().web);
  expect(response?.status(), 'GET / of web').toBe(200);
  const productItems = page.getByTestId('product');
  // Wait for the products first. A page with no product would pass the discount check with no meaning.
  if (expectedProducts === undefined) await expect(productItems, 'the list of products').not.toHaveCount(0);
  else await expect(productItems, 'the list of products').toHaveCount(expectedProducts);
  const shown = await productItems.count();
  await expect(page.getByTestId('discount'), `the discounts on the page, while ${FLAG_NAME} is ${state}`).toHaveCount(
    expectedDiscountCount(state, shown),
  );
  // Each discount belongs to a product. Two on one product and none on another would not pass.
  for (const product of await productItems.all()) {
    await expect(product.getByTestId('discount'), 'the discounts of one product').toHaveCount(expectedDiscountCount(state, 1));
  }
}

// State 1: the declared state. It runs in every environment and is part of the smoke subset.
// The requests send no header and read only.
test.describe('the flag show-discounts in its declared state', () => {
  const annotation = { type: FLAG_ANNOTATION, description: 'default' };

  test('the catalogue matches the declared state', { tag: '@smoke', annotation }, async ({ request }) => {
    await expectCatalogue(request, readDeclaredState());
  });

  test('the page matches the declared state', { tag: '@smoke', annotation }, async ({ page }) => {
    await expectPage(page, readDeclaredState());
  });
});

// State 2: the opposite of the declared state. A request with the header asks for it, in Test only. These tests skip in
// the other environments, with the reason in the report. They are not in the smoke subset: that subset runs after a
// deployment to Staging or Production, where the override is not allowed.
test.describe('the flag show-discounts in the opposite state, through the override', () => {
  const annotation = { type: FLAG_ANNOTATION, description: 'override' };

  // The reason shows in the report of the skipped tests. The skip happens before a browser starts.
  const reason = overrideSkipReason('allowed');
  test.skip(reason !== undefined, reason ?? '');

  test('the catalogue matches the opposite state', { annotation }, async ({ request }) => {
    const declared = readDeclaredState();
    await expectCatalogue(request, oppositeState(declared), oppositeOverrideHeaders(declared));
  });

  test('the page matches the opposite state', { annotation }, async ({ page, request }) => {
    const declared = readDeclaredState();
    const headers = oppositeOverrideHeaders(declared);
    // The count of products comes from the catalogue with the same header, so the page must list all of them.
    const { products } = await fetchCatalogue(request, readUrls(), headers);
    expect(products.length, 'the number of products').toBeGreaterThan(0);
    // The browser sends the header with the request for the page. Web forwards it to the catalogue in Test.
    await page.setExtraHTTPHeaders(headers);
    await expectPage(page, oppositeState(declared), products.length);
  });
});

// State 3: the override is not allowed. Staging and Production must ignore the header, so the product keeps the
// declared state even when the request asks for the opposite. The request only reads, so it is safe for Production.
// It is part of the smoke subset and skips in Test.
test.describe('the flag show-discounts where the override is not allowed', () => {
  const annotation = { type: FLAG_ANNOTATION, description: 'override-ignored' };

  const reason = overrideSkipReason('ignored');
  test.skip(reason !== undefined, reason ?? '');

  test('the catalogue ignores the override header', { tag: '@smoke', annotation }, async ({ request }) => {
    const declared = readDeclaredState();
    await expectCatalogue(request, declared, oppositeOverrideHeaders(declared));
  });
});
