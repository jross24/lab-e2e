import { expect, test } from '@playwright/test';
import { readUrls } from '../lib/config.ts';
import { VERSION_TEST_IDS } from '../lib/page.ts';
import { VERSION_PATTERN } from '../lib/versions.ts';

// The page of web is the only thing that a visitor sees. If it renders data from the other services,
// the chain web -> catalogue and account -> core works. It is part of the smoke subset.
test('the page shows data from every service', { tag: '@smoke' }, async ({ page }) => {
  const response = await page.goto(readUrls().web);
  expect(response?.status(), 'GET / of web').toBe(200);

  await expect(page.getByTestId('catalogue-error'), 'the catalogue error block').toHaveCount(0);
  await expect(page.getByTestId('account-error'), 'the account error block').toHaveCount(0);

  for (const testId of Object.values(VERSION_TEST_IDS)) {
    await expect(page.getByTestId(testId), testId).toHaveText(VERSION_PATTERN);
  }
  await expect(page.getByTestId('product'), 'the list of products').not.toHaveCount(0);
  await expect(page.getByTestId('profile-name'), 'the name of the profile').toHaveText(/\S/);
});
