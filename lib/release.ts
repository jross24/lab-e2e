import { APPLICATIONS, VERSION_PATTERN } from './versions.ts';
import type { Versions } from './versions.ts';

// The release test. A pipeline that releases one service sets two variables:
//   E2E_EXPECT_SERVICE  web, catalogue, account, core, or the name of a service with no public endpoint
//   E2E_EXPECT_VERSION  the version of the release, for example 0.3.1
// For web, catalogue, account and core, the test checks that the public answers report that version.
// A service with no public endpoint (for example flags) publishes its version in the SSM parameter
// /lab/<service>/version. The action reads that parameter and sets E2E_PARAMETER_VERSION. The test compares it.
// The functions are pure: data in, problems out.

export type PublicService = (typeof APPLICATIONS)[number];

export interface Expectation {
  readonly service: string;
  readonly version: string;
}

// The name of a service outside the four. It goes into the path of an SSM parameter, so the form is strict:
// lower case letters, digits and single hyphens, a letter first, 40 characters at most.
const SERVICE_NAME_PATTERN = /^(?=.{1,40}$)[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// True for web, catalogue, account and core: their version is in the public answers.
export function usesPublicAnswers(service: string): service is PublicService {
  return (APPLICATIONS as readonly string[]).includes(service);
}

// The SSM parameter where a service with no public endpoint publishes its version.
export function parameterName(service: string): string {
  return `/lab/${service}/version`;
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
  } else if (!usesPublicAnswers(service) && !SERVICE_NAME_PATTERN.test(service)) {
    problems.push(
      `E2E_EXPECT_SERVICE must be one of ${APPLICATIONS.join(', ')}, or a name of lower case letters, digits and hyphens that starts with a letter`,
    );
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
  return { service, version };
}

// Returns one sentence for each place that reports another version than the release.
// It looks only at the released service. The other services can be at any version.
// It is for web, catalogue, account and core. For another service it throws: no public answer holds its version,
// and an empty list would pass the release in silence. Use findParameterProblems for such a service.
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
    default:
      throw new Error(`No public answer reports the version of ${service}. Read the SSM parameter ${parameterName(service)}.`);
  }

  const label = service === 'core' ? 'reports core' : 'reports';
  return sources
    .filter((source) => source.reports !== version)
    .map((source) => `Expected ${service} ${version}, but ${source.where} ${label} ${source.reports}.`);
}

// Reads E2E_PARAMETER_VERSION, the value of the SSM parameter that the action read. The action fails before the
// tests when it cannot read the parameter. So an empty variable here means a run outside the action.
// The error never prints the value of a bad variable.
export function readParameterVersion(service: string, env: Env = process.env): string {
  const value = env['E2E_PARAMETER_VERSION']?.trim() ?? '';
  if (value === '') {
    throw new Error(
      `The release check of ${service} needs E2E_PARAMETER_VERSION, the value of the SSM parameter ${parameterName(service)}. E2E_PARAMETER_VERSION is not set.`,
    );
  }
  if (!VERSION_PATTERN.test(value)) {
    throw new Error(`E2E_PARAMETER_VERSION must look like 1.2.3. It is the value of the SSM parameter ${parameterName(service)}.`);
  }
  return value;
}

// Returns one sentence when the parameter holds another version than the release.
export function findParameterProblems(expectation: Expectation, parameterVersion: string): string[] {
  const { service, version } = expectation;
  if (parameterVersion === version) return [];
  return [`Expected ${service} ${version}, but the SSM parameter ${parameterName(service)} reports ${parameterVersion}.`];
}
