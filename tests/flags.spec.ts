import { expect, test } from '@playwright/test';
import { fetchCatalogue } from '../lib/api.ts';
import { readUrls } from '../lib/config.ts';
import {
  FLAG_ANNOTATION,
  FLAG_NAME,
  OVERRIDE_HEADER,
  OVERRIDE_VALUE,
  overrideSkipReason,
  productsWithDiscount,
  productsWithoutNumericDiscount,
} from '../lib/flags.ts';

// The feature flag show-discounts has two states, and the suite tests both of them in every run against Test.
// The flag is off in every environment. In Test only, the header x-lab-flags can turn it on for one request.
// Staging and Production ignore the header. See lib/flags.ts and the README.
//
// Each test carries an annotation of the type flag-state. The summary reads it for its flag line.
const OVERRIDE = { [OVERRIDE_HEADER]: OVERRIDE_VALUE };

// State 1: the default. It is the state of Production, so it runs in every environment and is part of the smoke subset.
// The requests send no header and read only.
test.describe('the flag show-discounts in its default state', () => {
  const annotation = { type: FLAG_ANNOTATION, description: 'default' };

  test('the catalogue sends no discount', { tag: '@smoke', annotation }, async ({ request }) => {
    const { products } = await fetchCatalogue(request, readUrls());
    expect(products.length, 'the number of products').toBeGreaterThan(0);
    expect(productsWithDiscount(products), `products with the field discount, while ${FLAG_NAME} is off`).toEqual([]);
  });

  test('the page shows no discount', { tag: '@smoke', annotation }, async ({ page }) => {
    const response = await page.goto(readUrls().web);
    expect(response?.status(), 'GET / of web').toBe(200);
    // Wait for the products first. A page with no product would pass the next check with no meaning.
    await expect(page.getByTestId('product'), 'the list of products').not.toHaveCount(0);
    await expect(page.getByTestId('discount'), `the discounts on the page, while ${FLAG_NAME} is off`).toHaveCount(0);
  });
});

// State 2: the override. A request with the header turns the flag on in Test. These tests skip in the other
// environments, with the reason in the report. They are not in the smoke subset: that subset runs after a
// deployment to Staging or Production, where the override is not allowed.
test.describe('the flag show-discounts with the override', () => {
  const annotation = { type: FLAG_ANNOTATION, description: 'override-on' };

  // The reason shows in the report of the skipped tests. The skip happens before a browser starts.
  const reason = overrideSkipReason('allowed');
  test.skip(reason !== undefined, reason ?? '');

  test('the catalogue sends a number as discount for every product', { annotation }, async ({ request }) => {
    const { products } = await fetchCatalogue(request, readUrls(), OVERRIDE);
    expect(products.length, 'the number of products').toBeGreaterThan(0);
    expect(productsWithoutNumericDiscount(products), `products with no numeric discount, while the override turns ${FLAG_NAME} on`).toEqual([]);
  });

  test.describe('on the page', () => {
    // The browser sends the header with the request for the page. Web forwards it to the catalogue in Test.
    test.use({ extraHTTPHeaders: OVERRIDE });

    test('the page shows one discount for each product', { annotation }, async ({ page, request }) => {
      const urls = readUrls();
      const { products } = await fetchCatalogue(request, urls, OVERRIDE);
      expect(products.length, 'the number of products').toBeGreaterThan(0);

      const response = await page.goto(urls.web);
      expect(response?.status(), 'GET / of web').toBe(200);
      await expect(page.getByTestId('product'), 'the list of products').toHaveCount(products.length);
      await expect(page.getByTestId('discount'), 'the discounts on the page').toHaveCount(products.length);
      // Each discount belongs to a product. Two on one product and none on another would not pass.
      for (const product of await page.getByTestId('product').all()) {
        await expect(product.getByTestId('discount'), 'the discounts of one product').toHaveCount(1);
      }
    });
  });
});

// State 3: the override is not allowed. Staging and Production must ignore the header, so the flag stays off.
// The request only reads, so it is safe for Production. It is part of the smoke subset and skips in Test.
test.describe('the flag show-discounts where the override is not allowed', () => {
  const annotation = { type: FLAG_ANNOTATION, description: 'override-ignored' };

  const reason = overrideSkipReason('ignored');
  test.skip(reason !== undefined, reason ?? '');

  test('the catalogue ignores the override header', { tag: '@smoke', annotation }, async ({ request }) => {
    const { products } = await fetchCatalogue(request, readUrls(), OVERRIDE);
    expect(products.length, 'the number of products').toBeGreaterThan(0);
    expect(productsWithDiscount(products), 'products with the field discount, although this environment must ignore the override').toEqual([]);
  });
});
