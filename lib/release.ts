import { APPLICATIONS, VERSION_PATTERN } from './versions.ts';
import type { Versions } from './versions.ts';

// The release test. A pipeline that releases one service sets two variables:
//   E2E_EXPECT_SERVICE  one of web, catalogue, account, core
//   E2E_EXPECT_VERSION  the version of the release, for example 0.3.1
// The test then checks that the public answers report that version.
// The functions are pure: data in, problems out.

export type Service = (typeof APPLICATIONS)[number];

export interface Expectation {
  readonly service: Service;
  readonly version: string;
}

// The versions that the public answers report. Core is private, so two answers report its version:
// "core" is the one in the answer of the catalogue API, "accountCore" the one in the answer of the account API.
export type ReportedVersions = Versions & { readonly accountCore: string };

type Env = Readonly<Record<string, string | undefined>>;

// Returns undefined when both variables are not set: nobody asked for a release check.
// Throws one error that names every problem when only one variable is set or a value is bad.
// An empty value counts as not set, because the composite action sets an empty input as an empty variable.
// The error never prints the value of a bad variable.
export function readExpectation(env: Env = process.env): Expectation | undefined {
  const service = env['E2E_EXPECT_SERVICE']?.trim() ?? '';
  const version = env['E2E_EXPECT_VERSION']?.trim() ?? '';
  if (service === '' && version === '') return undefined;

  const problems: string[] = [];
  if (service === '') {
    problems.push('E2E_EXPECT_SERVICE is not set');
  } else if (!(APPLICATIONS as readonly string[]).includes(service)) {
    problems.push(`E2E_EXPECT_SERVICE must be one of ${APPLICATIONS.join(', ')}`);
  }
  if (version === '') {
    problems.push('E2E_EXPECT_VERSION is not set');
  } else if (!VERSION_PATTERN.test(version)) {
    problems.push('E2E_EXPECT_VERSION must look like 1.2.3');
  }

  if (problems.length > 0) {
    throw new Error(
      `The release check needs both E2E_EXPECT_SERVICE and E2E_EXPECT_VERSION, or neither. ${problems.join('. ')}.`,
    );
  }
  return { service: service as Service, version };
}

// Returns one sentence for each place that reports another version than the release.
// It looks only at the released service. The other services can be at any version.
export function findReleaseProblems(expectation: Expectation, reported: ReportedVersions): string[] {
  const { service, version } = expectation;
  const sources: { readonly where: string; readonly reports: string }[] = [];

  switch (service) {
    case 'web':
      sources.push({ where: 'GET /health of web', reports: reported.web });
      break;
    case 'catalogue':
      sources.push({ where: 'GET /products of the catalogue API', reports: reported.catalogue });
      break;
    case 'account':
      sources.push({ where: 'GET /profile of the account API', reports: reported.account });
      break;
    case 'core':
      sources.push(
        { where: 'GET /products of the catalogue API', reports: reported.core },
        { where: 'GET /profile of the account API', reports: reported.accountCore },
      );
      break;
  }

  const label = service === 'core' ? 'reports core' : 'reports';
  return sources
    .filter((source) => source.reports !== version)
    .map((source) => `Expected ${service} ${version}, but ${source.where} ${label} ${source.reports}.`);
}
