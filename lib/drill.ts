// The fault drill. It is a deliberate device that proves a failing suite stops a release,
// like injectFault in the service stacks.
//
// The owner of a service repository sets the repository variable E2E_FAULT_DRILL to one token.
// The pipeline passes it to the suite. A token is <suite>-<environment>, for example smoke-staging.
// The test fails on purpose in the one run that the token names. All other runs pass.
// The owner must remove the variable after the drill. The README explains the steps.

const SUITES = ['full', 'smoke'] as const;
const ENVIRONMENTS = ['test', 'staging', 'production'] as const;

export const DRILL_TOKENS: readonly string[] = SUITES.flatMap((suite) =>
  ENVIRONMENTS.map((environment) => `${suite}-${environment}`),
);

type Env = Readonly<Record<string, string | undefined>>;

// Returns the message of the failure, or undefined when the drill is off or names another run.
// A token that is not an allowed token also fails, in every run, so a typo cannot pass in silence.
// The message never prints the value of a bad token.
export function drillFailure(env: Env = process.env): string | undefined {
  const token = env['E2E_FAULT_DRILL']?.trim() ?? '';
  if (token === '') return undefined;

  if (!DRILL_TOKENS.includes(token)) {
    return `fault drill: E2E_FAULT_DRILL is not an allowed token. Allowed tokens: ${DRILL_TOKENS.join(', ')}. Remove the variable or set one of them.`;
  }

  const suite = env['E2E_SUITE']?.trim() ?? '';
  const environment = env['E2E_ENVIRONMENT']?.trim() ?? '';
  if (token !== `${suite}-${environment}`) return undefined;

  return `fault drill: this failure is on purpose. E2E_FAULT_DRILL is "${token}", and this run is the ${suite} suite against ${environment}. Remove the variable E2E_FAULT_DRILL to end the drill.`;
}
