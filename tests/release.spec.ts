import { test } from '@playwright/test';
import { fetchAccount, fetchCatalogue, fetchHealth } from '../lib/api.ts';
import { readUrls } from '../lib/config.ts';
import { findReleaseProblems, readExpectation } from '../lib/release.ts';
import type { ReportedVersions } from '../lib/release.ts';

// The pipeline that releases a service says which service and which version it released.
// This test checks that the public answers report that version. It is part of the smoke subset.
// Without a release to check (a nightly run, a manual run), the test is skipped.
// Core is private, so its version comes from the two answers that passed through core.
test('the released service reports the version of the release', { tag: '@smoke' }, async ({ request }) => {
  // This call fails the test when only one variable is set or a value is bad.
  const expectation = readExpectation();
  if (expectation === undefined) {
    test.skip(true, 'No release to check: E2E_EXPECT_SERVICE and E2E_EXPECT_VERSION are not set.');
    return;
  }

  const urls = readUrls();
  const [health, catalogue, account] = await Promise.all([
    fetchHealth(request, urls),
    fetchCatalogue(request, urls),
    fetchAccount(request, urls),
  ]);
  const reported: ReportedVersions = {
    web: health.version,
    catalogue: catalogue.version,
    account: account.version,
    core: catalogue.core.version,
    accountCore: account.core.version,
  };

  // A thrown error gives a short message in the summary. It names the service, the expected and the reported version.
  const problems = findReleaseProblems(expectation, reported);
  if (problems.length > 0) {
    throw new Error(`The release of ${expectation.service} is not what the services report. ${problems.join(' ')}`);
  }
});
