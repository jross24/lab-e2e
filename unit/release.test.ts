import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findParameterProblems,
  findReleaseProblems,
  parameterName,
  readExpectation,
  readParameterVersion,
  usesPublicAnswers,
} from '../lib/release.ts';
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

  it('fails on a service name that is not one of the four and not a good name', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'Billing', E2E_EXPECT_VERSION: '0.1.0' }), (error: Error) => {
      assert.match(error.message, /E2E_EXPECT_SERVICE must be one of web, catalogue, account, core/);
      return true;
    });
  });

  // A service with no public endpoint has a name of its own. The name goes into the path of an SSM parameter.
  for (const service of ['flags', 'billing', 'lab-flags', 'flags2', 'a']) {
    it(`accepts the service ${service}, which is not one of the four`, () => {
      assert.deepEqual(readExpectation({ E2E_EXPECT_SERVICE: service, E2E_EXPECT_VERSION: '0.1.0' }), {
        service,
        version: '0.1.0',
      });
    });
  }

  for (const bad of ['Flags', '1flags', 'flags_x', '-flags', 'flags-', 'fl--ags', '../web', 'a/b', 'flags*', 'flags v', `a${'b'.repeat(40)}`]) {
    it(`fails on the service name "${bad}"`, () => {
      assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: bad, E2E_EXPECT_VERSION: '0.1.0' }), /E2E_EXPECT_SERVICE must be one of/);
    });
  }

  it('is exact about the case of a service name', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'Web', E2E_EXPECT_VERSION: '0.1.0' }), /E2E_EXPECT_SERVICE/);
  });

  for (const bad of ['1.2', 'v1.2.3', '1.2.3.4', '1.2.x', 'latest', '1.2.3-rc1']) {
    it(`fails on the version "${bad}"`, () => {
      assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'web', E2E_EXPECT_VERSION: bad }), /E2E_EXPECT_VERSION must look like 1\.2\.3/);
    });
  }

  it('names both problems in one message', () => {
    assert.throws(() => readExpectation({ E2E_EXPECT_SERVICE: 'Nope', E2E_EXPECT_VERSION: '1.2' }), (error: Error) => {
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

describe('usesPublicAnswers', () => {
  for (const service of ['web', 'catalogue', 'account', 'core']) {
    it(`reads the public answers for ${service}`, () => {
      assert.equal(usesPublicAnswers(service), true);
    });
  }

  it('reads the SSM parameter for a service outside the four', () => {
    assert.equal(usesPublicAnswers('flags'), false);
  });
});

describe('findReleaseProblems for a service outside the four', () => {
  it('throws, so that a public answer is never taken for the version of such a service', () => {
    assert.throws(() => findReleaseProblems({ service: 'flags', version: '0.1.0' }, REPORTED), /flags/);
  });
});

describe('parameterName', () => {
  it('names the SSM parameter of the service', () => {
    assert.equal(parameterName('flags'), '/lab/flags/version');
  });
});

describe('readParameterVersion', () => {
  it('returns the value of the variable', () => {
    assert.equal(readParameterVersion('flags', { E2E_PARAMETER_VERSION: '0.2.0' }), '0.2.0');
  });

  it('removes spaces around the value', () => {
    assert.equal(readParameterVersion('flags', { E2E_PARAMETER_VERSION: ' 0.2.0\n' }), '0.2.0');
  });

  for (const env of [{}, { E2E_PARAMETER_VERSION: '' }, { E2E_PARAMETER_VERSION: '  ' }]) {
    it(`fails when the variable is not set (${JSON.stringify(env)}), and names the variable and the parameter`, () => {
      assert.throws(() => readParameterVersion('flags', env), (error: Error) => {
        assert.match(error.message, /E2E_PARAMETER_VERSION is not set/);
        assert.match(error.message, /\/lab\/flags\/version/);
        return true;
      });
    });
  }

  for (const bad of ['2.0', 'v1.2.3', 'latest', '1.2.3-rc1', 'None']) {
    it(`fails on the value "${bad}" and does not repeat it`, () => {
      assert.throws(() => readParameterVersion('flags', { E2E_PARAMETER_VERSION: bad }), (error: Error) => {
        assert.match(error.message, /E2E_PARAMETER_VERSION must look like 1\.2\.3/);
        assert.equal(error.message.includes(bad), false);
        return true;
      });
    });
  }
});

describe('findParameterProblems', () => {
  it('finds no problem when the parameter holds the version of the release', () => {
    assert.deepEqual(findParameterProblems({ service: 'flags', version: '0.2.0' }, '0.2.0'), []);
  });

  it('names the service, the expected version, the parameter and the reported version', () => {
    const problems = findParameterProblems({ service: 'flags', version: '0.2.0' }, '0.1.0');
    assert.deepEqual(problems, ['Expected flags 0.2.0, but the SSM parameter /lab/flags/version reports 0.1.0.']);
  });
});
