import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countOutcomes, renderSummary } from '../lib/summary.ts';
import type { SummaryInput, TestRecord } from '../lib/summary.ts';

const passed = (title: string): TestRecord => ({ title, outcome: 'passed', attempts: 1, durationMs: 800 });

const VERSIONS = { web: '0.1.0', catalogue: '0.1.0', account: '0.1.1', core: '0.1.0' };

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    environment: 'test',
    commit: '0123456789abcdef0123456789abcdef01234567',
    tests: [passed('page'), passed('api'), passed('consistency')],
    versions: VERSIONS,
    warmup: { healthTries: 1, pageTries: 3, elapsedMs: 7_400 },
    durationMs: 12_300,
    errors: [],
    ...overrides,
  };
}

describe('countOutcomes', () => {
  it('counts each outcome', () => {
    const tests: TestRecord[] = [
      passed('a'),
      { title: 'b', outcome: 'failed', attempts: 2, durationMs: 1 },
      { title: 'c', outcome: 'flaky', attempts: 2, durationMs: 1 },
      { title: 'd', outcome: 'skipped', attempts: 0, durationMs: 0 },
      passed('e'),
    ];
    assert.deepEqual(countOutcomes(tests), { passed: 2, failed: 1, flaky: 1, skipped: 1 });
  });
});

describe('renderSummary', () => {
  it('shows the exact versions, the commit and the counts', () => {
    const text = renderSummary(input());
    assert.match(text, /### E2E against test: passed/);
    assert.match(text, /\| web \| `0\.1\.0` \|/);
    assert.match(text, /\| catalogue \| `0\.1\.0` \|/);
    assert.match(text, /\| account \| `0\.1\.1` \|/);
    assert.match(text, /\| core \| `0\.1\.0` \|/);
    assert.match(text, /lab-e2e commit.*`0123456789abcdef0123456789abcdef01234567`/);
    assert.match(text, /3 passed, 0 failed, 0 flaky, 0 skipped/);
  });

  it('shows the warm-up, so a cold start is visible', () => {
    assert.match(renderSummary(input()), /Warm-up.*\/health 1 try.*page 3 tries.*7\.4 s/);
  });

  it('does not call a run passed when no test passed', () => {
    const skipped = [{ title: 'page', outcome: 'skipped', attempts: 0, durationMs: 0 } satisfies TestRecord];
    assert.match(renderSummary(input({ tests: skipped })), /### E2E against test: failed/);
    assert.match(renderSummary(input({ tests: [] })), /### E2E against test: failed/);
  });

  it('names the smoke suite in the title', () => {
    assert.match(renderSummary(input({ environment: 'staging', suite: 'smoke' })), /^### E2E against staging \(smoke\): passed$/m);
  });

  it('keeps the title of the full suite plain, with or without the suite field', () => {
    assert.match(renderSummary(input({ suite: 'full' })), /^### E2E against test: passed$/m);
    assert.match(renderSummary(input()), /^### E2E against test: passed$/m);
  });

  it('shows the verdict of a failed smoke run in the title', () => {
    const tests = [{ title: 'drill', outcome: 'failed', attempts: 1, durationMs: 1, error: 'fault drill: on purpose' } satisfies TestRecord];
    assert.match(renderSummary(input({ environment: 'production', suite: 'smoke', tests })), /^### E2E against production \(smoke\): failed$/m);
  });

  it('does not call a run failed because one test was skipped', () => {
    const tests = [passed('page'), { title: 'release', outcome: 'skipped', attempts: 0, durationMs: 0 } satisfies TestRecord];
    const text = renderSummary(input({ suite: 'smoke', tests }));
    assert.match(text, /### E2E against test \(smoke\): passed/);
    assert.match(text, /1 passed, 0 failed, 0 flaky, 1 skipped/);
  });

  it('says that no retry was used', () => {
    assert.match(renderSummary(input()), /Retries used: none/);
  });

  it('names a test that passed only on a retry, and does not call the run clean', () => {
    const tests = [passed('page'), { title: 'consistency', outcome: 'flaky', attempts: 2, durationMs: 1 } satisfies TestRecord];
    const text = renderSummary(input({ tests }));
    assert.match(text, /### E2E against test: passed with 1 retry/);
    assert.match(text, /Retries used: consistency \(2 attempts, passed on the retry\)/);
    assert.match(text, /1 flaky/);
  });

  it('names a test that failed after a retry', () => {
    const tests = [{ title: 'api', outcome: 'failed', attempts: 2, durationMs: 1 } satisfies TestRecord];
    const text = renderSummary(input({ tests }));
    assert.match(text, /### E2E against test: failed/);
    assert.match(text, /Retries used: api \(2 attempts, failed again\)/);
  });

  it('shows the failed test titles', () => {
    const tests = [passed('page'), { title: 'api', outcome: 'failed', attempts: 1, durationMs: 1, error: 'expected 200, got 404' } satisfies TestRecord];
    const text = renderSummary(input({ tests }));
    assert.match(text, /Failed tests/);
    assert.match(text, /api: expected 200, got 404/);
  });

  it('says so when no version was recorded', () => {
    const text = renderSummary(input({ versions: undefined }));
    assert.match(text, /No version was recorded/);
    assert.doesNotMatch(text, /\| web \|/);
  });

  it('shows a run error, such as a failed warm-up, and fails', () => {
    const text = renderSummary(input({ tests: [], versions: undefined, warmup: undefined, errors: ['Warm-up failed. the page did not work.'] }));
    assert.match(text, /### E2E against test: failed/);
    assert.match(text, /Warm-up failed\. the page did not work\./);
  });

  it('does not let a test title or error break the table or the markdown', () => {
    const tests = [{ title: 'a | b', outcome: 'failed', attempts: 1, durationMs: 1, error: 'x\ny' } satisfies TestRecord];
    const text = renderSummary(input({ tests }));
    assert.match(text, /a \\| b: x y/);
  });

  it('keeps the account ID and the secrets out: it prints only what it is given', () => {
    assert.doesNotMatch(renderSummary(input()), /\d{12}/);
  });
});
