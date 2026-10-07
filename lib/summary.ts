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
}

export interface SummaryInput {
  readonly environment: string;
  readonly commit: string;
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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function renderSummary(input: SummaryInput): string {
  const counts = countOutcomes(input.tests);
  // A run where no test passed is not a pass, for example when every test was skipped.
  const failed = counts.failed > 0 || input.errors.length > 0 || counts.passed + counts.flaky === 0;
  const retried = input.tests.filter((test) => test.attempts > 1);

  let verdict = 'passed';
  if (failed) verdict = 'failed';
  else if (counts.flaky > 0) verdict = `passed with ${plural(counts.flaky, 'retry', 'retries')}`;

  const lines: string[] = [
    `### E2E against ${input.environment}: ${verdict}`,
    '',
    `- Result: ${counts.passed} passed, ${counts.failed} failed, ${counts.flaky} flaky, ${counts.skipped} skipped (${seconds(input.durationMs)}).`,
    `- lab-e2e commit: \`${input.commit}\``,
  ];

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
