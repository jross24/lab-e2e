import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { FullResult, Reporter, Suite, TestCase, TestError } from '@playwright/test/reporter';
import { FLAG_ANNOTATION, STATE_VARIABLE, isFlagKind, parseDeclaredState } from '../lib/flags.ts';
import { RUN_DIR, SUMMARY_FILE, VERSIONS_FILE, WARMUP_FILE } from '../lib/paths.ts';
import { renderSummary } from '../lib/summary.ts';
import type { SummaryInput, TestRecord } from '../lib/summary.ts';
import { APPLICATIONS } from '../lib/versions.ts';
import type { Versions } from '../lib/versions.ts';

// Writes the summary of the run:
//   - to the job summary of GitHub ($GITHUB_STEP_SUMMARY), when it exists
//   - to the log
//   - to .e2e/summary.md and .e2e/versions.json, so the workflow can read the versions
// The consistency test attaches the versions that it observed under the name "observed-versions".
const VERSIONS_ATTACHMENT = 'observed-versions';

function isVersions(value: unknown): value is Versions {
  if (typeof value !== 'object' || value === null) return false;
  return APPLICATIONS.every((name) => typeof (value as Record<string, unknown>)[name] === 'string');
}

function toRecord(test: TestCase): TestRecord {
  const outcome = test.outcome();
  const last = test.results.at(-1);
  // A test of the feature flag marks its state with an annotation. See lib/flags.ts.
  const described = test.annotations.find((item) => item.type === FLAG_ANNOTATION)?.description;
  const flagKind = isFlagKind(described) ? described : undefined;
  return {
    title: test.title,
    outcome: outcome === 'expected' ? 'passed' : outcome === 'unexpected' ? 'failed' : outcome,
    attempts: test.results.length,
    durationMs: test.results.reduce((sum, result) => sum + result.duration, 0),
    ...(last?.error?.message ? { error: last.error.message } : {}),
    ...(flagKind === undefined ? {} : { flagKind }),
  };
}

function findVersions(tests: readonly TestCase[]): Versions | undefined {
  for (const test of tests) {
    // The newest attempt first. Only an attempt that read all three sources has the attachment.
    for (const result of [...test.results].reverse()) {
      const attachment = result.attachments.find((item) => item.name === VERSIONS_ATTACHMENT);
      if (!attachment?.body) continue;
      const parsed: unknown = JSON.parse(attachment.body.toString('utf8'));
      if (isVersions(parsed)) return parsed;
    }
  }
  return undefined;
}

// Only a file that this run wrote counts. An old file from an earlier local run does not.
function readWarmup(startedAt: number): SummaryInput['warmup'] {
  try {
    if (statSync(WARMUP_FILE).mtimeMs < startedAt) return undefined;
    return JSON.parse(readFileSync(WARMUP_FILE, 'utf8')) as SummaryInput['warmup'];
  } catch {
    return undefined;
  }
}

function flagDeclared(): Pick<SummaryInput, 'flagDeclared'> {
  const declared = parseDeclaredState(process.env[STATE_VARIABLE]);
  return declared === undefined ? {} : { flagDeclared: declared };
}

function commit(): string {
  const fromEnvironment = process.env['E2E_COMMIT'];
  if (fromEnvironment) return fromEnvironment;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

export default class SummaryReporter implements Reporter {
  private suite: Suite | undefined;
  private readonly errors: string[] = [];
  private readonly startedAt = Date.now();

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  // An error of the run itself, for example a failed warm-up in the global setup.
  onError(error: TestError): void {
    this.errors.push(error.message ?? String(error));
  }

  onEnd(result: FullResult): void {
    const allTests = this.suite?.allTests() ?? [];
    // "playwright test --list" finds the tests and runs none of them. It has nothing to report.
    if (this.errors.length === 0 && allTests.every((test) => test.results.length === 0)) return;
    const tests = allTests.map(toRecord);
    const versions = findVersions(allTests);

    const markdown = renderSummary({
      environment: process.env['E2E_ENVIRONMENT'] ?? 'unknown',
      suite: process.env['E2E_SUITE'] === 'smoke' ? 'smoke' : 'full',
      commit: commit(),
      // The declared state comes from the same variable as the tests. An unset or bad value shows as unknown.
      ...flagDeclared(),
      tests,
      versions,
      warmup: readWarmup(this.startedAt),
      durationMs: result.duration,
      errors: this.errors,
    });

    mkdirSync(RUN_DIR, { recursive: true });
    writeFileSync(SUMMARY_FILE, markdown);
    if (versions) writeFileSync(VERSIONS_FILE, JSON.stringify(versions));
    else rmSync(VERSIONS_FILE, { force: true });

    const target = process.env['GITHUB_STEP_SUMMARY'];
    if (target) appendFileSync(target, `${markdown}\n`);
    console.log(`\n${markdown}`);

    // A retry is a warning, not a pass without comment.
    if (process.env['GITHUB_ACTIONS']) {
      for (const test of tests.filter((item) => item.attempts > 1)) {
        console.log(`::warning title=E2E retry used::${test.title} needed ${test.attempts} attempts (${test.outcome}).`);
      }
    }
  }
}
