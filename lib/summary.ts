import { FLAG_NAME, oppositeState } from './flags.ts';
import type { FlagKind, FlagValue } from './flags.ts';
import { APPLICATIONS } from './versions.ts';
import type { Versions } from './versions.ts';

// The job summary of a run. The functions are pure: data in, markdown out.

export interface TestRecord {
  readonly title: string;
  // passed: passed on the first attempt. flaky: failed first, passed on the retry.
  readonly outcome: 'passed' | 'failed' | 'flaky' | 'skipped';
  readonly attempts: number;
  readonly durationMs: number;
  readonly error?: string;
  // Set by a test of the feature flag. The flag line of the summary uses it.
  readonly flagKind?: FlagKind;
}

export interface SummaryInput {
  readonly environment: string;
  // Which suite ran. The default is full. The title names the smoke suite, so a reader sees that it ran.
  readonly suite?: 'full' | 'smoke';
  readonly commit: string;
  // The declared state of the flag in this environment, as the suite action read it. Missing when the run has none.
  readonly flagDeclared?: FlagValue;
  readonly tests: readonly TestRecord[];
  readonly versions: Versions | undefined;
  readonly warmup: { readonly healthTries: number; readonly pageTries: number; readonly elapsedMs: number } | undefined;
  readonly durationMs: number;
  // Errors of the run itself, for example a failed warm-up. They are not errors of one test.
  readonly errors: readonly string[];
}

export interface Counts {
  readonly passed: number;
  readonly failed: number;
  readonly flaky: number;
  readonly skipped: number;
}

export function countOutcomes(tests: readonly TestRecord[]): Counts {
  const count = (outcome: TestRecord['outcome']) => tests.filter((test) => test.outcome === outcome).length;
  return { passed: count('passed'), failed: count('failed'), flaky: count('flaky'), skipped: count('skipped') };
}

// Playwright colours its error text. Remove the colour codes, join the lines and cut a long text.
function oneLine(text: string, limit = 300): string {
  const plain = text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > limit ? `${plain.slice(0, limit)}...` : plain;
}

// A pipe would end a table cell. A title is plain text.
function escapeText(text: string): string {
  return text.replace(/\|/g, '\|');
}

type StateStatus = 'passed' | 'failed' | 'not-tested';

// A state passed when it has tests and every one of them passed (on the first try or on the retry).
// One failed test fails the state. A skipped test, or no test at all, means the state was not tested.
function stateStatus(tests: readonly TestRecord[], kind: FlagKind): StateStatus {
  const own = tests.filter((test) => test.flagKind === kind);
  if (own.some((test) => test.outcome === 'failed')) return 'failed';
  if (own.length > 0 && own.every((test) => test.outcome === 'passed' || test.outcome === 'flaky')) return 'passed';
  return 'not-tested';
}

// One line that says which state of the feature flag the environment declares and which states the run tested.
// The default tests check the declared state. The override tests check the opposite state, through the header.
// There is no line when no test has a flag kind. In Staging and Production the override is not allowed. The line then
// says whether the check that the environment ignores the override passed. A run with no declared state says unknown.
export function flagLine(tests: readonly TestRecord[], declared: FlagValue | undefined): string | undefined {
  if (!tests.some((test) => test.flagKind !== undefined)) return undefined;

  const declaredText = declared ?? 'unknown';
  const oppositeText = declared === undefined ? 'unknown' : oppositeState(declared);
  const standard = stateStatus(tests, 'default');
  const override = stateStatus(tests, 'override');
  const ignored = stateStatus(tests, 'override-ignored');

  const defaultResult = standard === 'passed' ? 'tested' : standard === 'failed' ? 'FAILED' : 'not tested';
  const defaultPart = `default ${declaredText}: ${defaultResult}`;

  let overrideResult: string;
  if (override === 'passed') overrideResult = 'tested';
  else if (override === 'failed') overrideResult = 'FAILED';
  else if (ignored === 'passed') overrideResult = 'not allowed here (override ignored: checked)';
  else if (ignored === 'failed') overrideResult = 'not allowed here (override ignored: FAILED)';
  else overrideResult = 'not tested';

  return `- ${FLAG_NAME}: declared ${declaredText}; ${defaultPart}; override ${oppositeText}: ${overrideResult}.`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function renderSummary(input: SummaryInput): string {
  const counts = countOutcomes(input.tests);
  // A run where no test passed is not a pass, for example when every test was skipped.
  // One skipped test, for example the release test with no release to check, does not fail a run.
  const failed = counts.failed > 0 || input.errors.length > 0 || counts.passed + counts.flaky === 0;
  const retried = input.tests.filter((test) => test.attempts > 1);

  let verdict = 'passed';
  if (failed) verdict = 'failed';
  else if (counts.flaky > 0) verdict = `passed with ${plural(counts.flaky, 'retry', 'retries')}`;

  // The full suite is the default, so its title has no suffix. The smoke suite adds "(smoke)".
  const suite = input.suite ?? 'full';
  const title = suite === 'full' ? input.environment : `${input.environment} (${suite})`;

  const lines: string[] = [
    `### E2E against ${title}: ${verdict}`,
    '',
    `- Result: ${counts.passed} passed, ${counts.failed} failed, ${counts.flaky} flaky, ${counts.skipped} skipped (${seconds(input.durationMs)}).`,
    `- lab-e2e commit: \`${input.commit}\``,
  ];

  const flags = flagLine(input.tests, input.flagDeclared);
  if (flags !== undefined) lines.push(flags);

  if (input.warmup) {
    const { healthTries, pageTries, elapsedMs } = input.warmup;
    lines.push(`- Warm-up: /health ${plural(healthTries, 'try', 'tries')}, page ${plural(pageTries, 'try', 'tries')}, ${seconds(elapsedMs)}.`);
  }

  if (retried.length === 0) {
    lines.push('- Retries used: none.');
  } else {
    const parts = retried.map((test) => {
      const how = test.outcome === 'flaky' ? 'passed on the retry' : 'failed again';
      return `${escapeText(test.title)} (${test.attempts} attempts, ${how})`;
    });
    lines.push(`- Retries used: ${parts.join('; ')}`);
  }

  lines.push('');
  if (input.versions) {
    lines.push('| Application | Version tested |', '| --- | --- |');
    for (const name of APPLICATIONS) lines.push(`| ${name} | \`${input.versions[name]}\` |`);
  } else {
    lines.push('No version was recorded. The run stopped before the consistency test read them.');
  }

  const failures = input.tests.filter((test) => test.outcome === 'failed');
  if (failures.length > 0 || input.errors.length > 0) {
    lines.push('', '#### Failed tests and errors', '');
    for (const test of failures) {
      lines.push(`- ${escapeText(test.title)}: ${oneLine(test.error ?? 'no message')}`);
    }
    for (const error of input.errors) lines.push(`- ${oneLine(error)}`);
  }

  return `${lines.join('\n')}\n`;
}
