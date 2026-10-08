import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findReleaseProblems, readExpectation } from '../lib/release.ts';
import type { ReportedVersions } from '../lib/release.ts';

// What the three public answers report. Core has two sources: the catalogue API and the account API.
const REPORTED: ReportedVersions = {
  web: '0.3.0',
  catalogue: '0.4.1',
  account: '0.5.2',
  core: '0.6.3',
  accountCore: '0.6.3',
};

describe('readExpectation', () => {
  it('returns undefined when both variables are not set: no release to check', () => {
    assert.equal(readExpectation({}), undefined);
  });

  it('treats empty values like unset values, because the composite action sets them empty', () => {
    assert.equal(readExpectation({ E2E_EXPECT_SERVICE: '', E2E_EXPECT_VERSION: '  ' }), undefined);
  });

  for (const service of ['web', 'catalogue', 'account', 'core']) {
    it(`accepts the service ${service}`, () => {
      assert.deepEqual(readExpectation({ E2E_EXPECT_SERVICE: service, E2E_EXPECT_VERSION: '1.22.333' }), {
        service,
        version: '1.22.333',
      });
    });
  }

  it('removes spaces around the values', () => {
    assert.deepEqual(readExpectation({ E2E_EXPECT_SERVICE: ' web ', E2E_EXPECT_VERSION: ' 0.1.0 ' }), {
      service: 'web',
      version: '0.1.0',
    });
  });

  it('fails when only the version is set', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_VERSION: '0.1.0' }), (error: Error) => {
      assert.match(error.message, /E2E_EXPECT_SERVICE is not set/);
      assert.doesNotMatch(error.message, /E2E_EXPECT_VERSION is not set/);
      assert.match(error.message, /both/i);
      return true;
    });
  });

  it('fails when only the service is set', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'web', E2E_EXPECT_VERSION: '' }), /E2E_EXPECT_VERSION is not set/);
  });

  it('fails on a service name that is not one of the four', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'billing', E2E_EXPECT_VERSION: '0.1.0' }), (error: Error) => {
      assert.match(error.message, /E2E_EXPECT_SERVICE must be one of web, catalogue, account, core/);
      return true;
    });
  });

  it('is exact about the case of a service name', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'Web', E2E_EXPECT_VERSION: '0.1.0' }), /E2E_EXPECT_SERVICE/);
  });

  for (const bad of ['1.2', 'v1.2.3', '1.2.3.4', '1.2.x', 'latest', '1.2.3-rc1']) {
    it(`fails on the version "${bad}"`, () => {
      assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'web', E2E_EXPECT_VERSION: bad }), /E2E_EXPECT_VERSION must look like 1\.2\.3/);
    });
  }

  it('names both problems in one message', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'nope', E2E_EXPECT_VERSION: '1.2' }), (error: Error) => {
      assert.match(error.message, /E2E_EXPECT_SERVICE must be/);
      assert.match(error.message, /E2E_EXPECT_VERSION must look like/);
      return true;
    });
  });

  it('does not repeat the value of a bad variable', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'web', E2E_EXPECT_VERSION: 'secret-looking-value' }), (error: Error) => {
      assert.doesNotMatch(error.message, /secret-looking-value/);
      return true;
    });
  });
});

describe('findReleaseProblems', () => {
  it('finds no problem when web reports the version of the release', () => {
    assert.deepEqual(findReleaseProblems({ service: 'web', version: '0.3.0' }, REPORTED), []);
  });

  it('finds no problem when catalogue reports the version of the release', () => {
    assert.deepEqual(findReleaseProblems({ service: 'catalogue', version: '0.4.1' }, REPORTED), []);
  });

  it('finds no problem when account reports the version of the release', () => {
    assert.deepEqual(findReleaseProblems({ service: 'account', version: '0.5.2' }, REPORTED), []);
  });

  it('finds no problem when both APIs report the version of core of the release', () => {
    assert.deepEqual(findReleaseProblems({ service: 'core', version: '0.6.3' }, REPORTED), []);
  });

  it('does not look at the other services', () => {
    // The release is catalogue 0.4.1. A different web version is not a problem for this check.
    assert.deepEqual(findReleaseProblems({ service: 'catalogue', version: '0.4.1' }, { ...REPORTED, web: '9.9.9' }), []);
  });

  it('names the service, the expected version and the reported version', () => {
    const problems = findReleaseProblems({ service: 'web', version: '0.3.1' }, REPORTED);
    assert.deepEqual(problems, ['Expected web 0.3.1, but GET /health of web reports 0.3.0.']);
  });

  it('names the endpoint of catalogue', () => {
    const problems = findReleaseProblems({ service: 'catalogue', version: '0.4.2' }, REPORTED);
    assert.deepEqual(problems, ['Expected catalogue 0.4.2, but GET /products of the catalogue API reports 0.4.1.']);
  });

  it('names the endpoint of account', () => {
    const problems = findReleaseProblems({ service: 'account', version: '0.5.3' }, REPORTED);
    assert.deepEqual(problems, ['Expected account 0.5.3, but GET /profile of the account API reports 0.5.2.']);
  });

  it('reports core as old when only the catalogue API sees the old core', () => {
    const problems = findReleaseProblems({ service: 'core', version: '0.7.0' }, { ...REPORTED, accountCore: '0.7.0' });
    assert.deepEqual(problems, ['Expected core 0.7.0, but GET /products of the catalogue API reports core 0.6.3.']);
  });

  it('reports core as old when only the account API sees the old core', () => {
    const problems = findReleaseProblems({ service: 'core', version: '0.7.0' }, { ...REPORTED, core: '0.7.0' });
    assert.deepEqual(problems, ['Expected core 0.7.0, but GET /profile of the account API reports core 0.6.3.']);
  });

  it('lists both problems when both APIs see the old core', () => {
    const problems = findReleaseProblems({ service: 'core', version: '0.7.0' }, REPORTED);
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /catalogue API reports core 0\.6\.3/);
    assert.match(problems[1] ?? '', /account API reports core 0\.6\.3/);
  });
});
