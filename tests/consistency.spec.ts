import { expect, test } from '@playwright/test';
import { fetchAccount, fetchCatalogue, fetchHealth } from '../lib/api.ts';
import { readUrls } from '../lib/config.ts';
import { readPageVersions } from '../lib/page.ts';
import type { Versions } from '../lib/versions.ts';

// The page shows a version for each application. Each service reports its own version too.
// The two must agree. A mix of versions shows that one part of the chain is not at the new release.
//
// Core is private, so the test cannot ask core. It reads the version of core from the two answers
// that passed through core. That also proves that the private call works.
test('the versions on the page equal the versions that the services report', async ({ page, request }) => {
  const urls = readUrls();

  const [health, catalogue, account] = await Promise.all([
    fetchHealth(request, urls),
    fetchCatalogue(request, urls),
    fetchAccount(request, urls),
  ]);
  const response = await page.goto(urls.web);
  expect(response?.status(), 'GET / of web').toBe(200);
  const onPage = await readPageVersions(page);

  const reported: Versions = {
    web: health.version,
    catalogue: catalogue.version,
    account: account.version,
    core: catalogue.core.version,
  };

  // The summary of the run reads this attachment. It is the exact set of versions that the run tested.
  await test.info().attach('observed-versions', { body: JSON.stringify(reported), contentType: 'application/json' });

  // Both services see the same core. If they differ, the page shows both values, so the second check fails too.
  expect(account.core.version, 'the core version that the account API sees, against the catalogue API').toBe(
    catalogue.core.version,
  );
  expect(onPage, 'the versions on the page, against the versions that the services report').toEqual(reported);
});
