import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DRILL_TOKENS, drillFailure } from '../lib/drill.ts';

const ON_PURPOSE = /^fault drill: this failure is on purpose/;

describe('drillFailure', () => {
  it('is off when the variable is not set', () => {
    assert.equal(drillFailure({ E2E_SUITE: 'full', E2E_ENVIRONMENT: 'test' }), undefined);
  });

  it('is off when the variable is empty, because the composite action sets it empty', () => {
    assert.equal(drillFailure({ E2E_FAULT_DRILL: '', E2E_SUITE: 'full', E2E_ENVIRONMENT: 'test' }), undefined);
    assert.equal(drillFailure({ E2E_FAULT_DRILL: '  ', E2E_SUITE: 'full', E2E_ENVIRONMENT: 'test' }), undefined);
  });

  for (const [suite, environment] of [
    ['full', 'test'],
    ['smoke', 'staging'],
    ['smoke', 'production'],
  ]) {
    it(`fails on purpose in the run ${suite}-${environment}`, () => {
      const message = drillFailure({ E2E_FAULT_DRILL: `${suite}-${environment}`, E2E_SUITE: suite, E2E_ENVIRONMENT: environment });
      assert.match(message ?? '', ON_PURPOSE);
      assert.match(message ?? '', /E2E_FAULT_DRILL/);
      assert.match(message ?? '', new RegExp(`${suite}-${environment}`));
    });
  }

  it('names the variable and says how to stop the drill', () => {
    const message = drillFailure({ E2E_FAULT_DRILL: 'smoke-staging', E2E_SUITE: 'smoke', E2E_ENVIRONMENT: 'staging' });
    assert.match(message ?? '', /Remove the variable/);
  });

  it('passes in a run that the token does not name', () => {
    const drill = 'smoke-staging';
    assert.equal(drillFailure({ E2E_FAULT_DRILL: drill, E2E_SUITE: 'smoke', E2E_ENVIRONMENT: 'production' }), undefined);
    assert.equal(drillFailure({ E2E_FAULT_DRILL: drill, E2E_SUITE: 'full', E2E_ENVIRONMENT: 'staging' }), undefined);
    assert.equal(drillFailure({ E2E_FAULT_DRILL: drill, E2E_SUITE: 'full', E2E_ENVIRONMENT: 'test' }), undefined);
  });

  it('passes when the run says nothing about its suite and environment', () => {
    assert.equal(drillFailure({ E2E_FAULT_DRILL: 'full-test' }), undefined);
  });

  it('removes spaces and line breaks around the token', () => {
    const message = drillFailure({ E2E_FAULT_DRILL: ' full-test\n', E2E_SUITE: 'full', E2E_ENVIRONMENT: 'test' });
    assert.match(message ?? '', ON_PURPOSE);
  });

  for (const bad of ['yes', 'true', 'test', 'smoke', 'Full-Test', 'full-dev', 'smoke-', 'full-test-now', 'all-test']) {
    it(`fails on the bad token "${bad}" and lists the allowed tokens`, () => {
      const message = drillFailure({ E2E_FAULT_DRILL: bad, E2E_SUITE: 'full', E2E_ENVIRONMENT: 'test' });
      assert.match(message ?? '', /E2E_FAULT_DRILL/);
      assert.match(message ?? '', /not an allowed token/);
      assert.doesNotMatch(message ?? '', ON_PURPOSE);
      for (const token of DRILL_TOKENS) assert.match(message ?? '', new RegExp(token));
    });
  }

  it('fails on a bad token in every run, so a typo cannot hide', () => {
    const message = drillFailure({ E2E_FAULT_DRILL: 'smoke-prod', E2E_SUITE: 'smoke', E2E_ENVIRONMENT: 'production' });
    assert.match(message ?? '', /not an allowed token/);
  });

  it('has six allowed tokens: two suites for three environments', () => {
    assert.deepEqual([...DRILL_TOKENS].sort(), [
      'full-production',
      'full-staging',
      'full-test',
      'smoke-production',
      'smoke-staging',
      'smoke-test',
    ]);
  });
});
