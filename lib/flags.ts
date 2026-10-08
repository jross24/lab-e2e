// The feature flag show-discounts. The suite follows the DECLARED state of the flag in the environment under test.
//
// The flag file of lab-flags declares a state for each environment: on or off. The stack of lab-flags writes the
// declared state to the SSM parameter /lab/flags/state/show-discounts. The suite action reads the parameter and passes
// it to the tests in the variable E2E_FLAG_SHOW_DISCOUNTS. The default tests assert that the product matches it.
//
// In Test only, the request header x-lab-flags can set the flag to on or off for that one request. There the suite
// also tests the OPPOSITE of the declared state through the header. Staging and Production ignore the header, so
// they must keep the declared state even when the request asks for the opposite. The suite checks that too.
//
// The functions here are pure, so the unit tests need no network and no browser.

export const FLAG_NAME = 'show-discounts';
export const OVERRIDE_HEADER = 'x-lab-flags';

// The variable that holds the declared state, and the SSM parameter that the suite action reads it from.
export const STATE_VARIABLE = 'E2E_FLAG_SHOW_DISCOUNTS';
export const STATE_PARAMETER = `/lab/flags/state/${FLAG_NAME}`;

// The state of the flag: on or off. The declared state is one of the two.
export type FlagValue = 'on' | 'off';

export function oppositeState(state: FlagValue): FlagValue {
  return state === 'on' ? 'off' : 'on';
}

// Returns on or off, or undefined when the text is neither. The text must be exactly on or off, around spaces.
export function parseDeclaredState(text: string | undefined): FlagValue | undefined {
  const value = text?.trim();
  return value === 'on' || value === 'off' ? value : undefined;
}

// Reads the declared state when a test calls it, not when the module loads. So "playwright test --list" works with
// the variable unset. The error never prints the value of a bad variable.
export function readDeclaredState(env: Readonly<Record<string, string | undefined>> = process.env): FlagValue {
  const raw = env[STATE_VARIABLE];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `The test needs the declared state of the flag ${FLAG_NAME}. ${STATE_VARIABLE} is not set. The suite action reads it from the SSM parameter ${STATE_PARAMETER}. For a run on a laptop, set ${STATE_VARIABLE} to on or off.`,
    );
  }
  const state = parseDeclaredState(raw);
  if (state === undefined) {
    throw new Error(`${STATE_VARIABLE} must be on or off. The test refuses any other value.`);
  }
  return state;
}

// The header that asks the product for one state of the flag, for one request.
export function overrideHeaders(state: FlagValue): Record<string, string> {
  return { [OVERRIDE_HEADER]: `${FLAG_NAME}=${state}` };
}

// The header that asks for the OPPOSITE of the declared state. Test must follow it. Staging and Production must not.
export function oppositeOverrideHeaders(declared: FlagValue): Record<string, string> {
  return overrideHeaders(oppositeState(declared));
}

// The tests mark themselves with an annotation of this type. The summary reporter reads it,
// so the summary can say which states of the flag the run tested.
export const FLAG_ANNOTATION = 'flag-state';

// default: the flag as the environment declares it, with no header. It runs in every environment.
// override: a request with the header for the opposite state, in an environment that allows it (Test).
// override-ignored: a request with the header for the opposite state, in an environment that must ignore it.
export const FLAG_KINDS = ['default', 'override', 'override-ignored'] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export function isFlagKind(value: unknown): value is FlagKind {
  return FLAG_KINDS.some((kind) => kind === value);
}

type Env = Readonly<Record<string, string | undefined>>;

// allowed: the environment lets the header turn the flag on. ignored: it must not.
// unknown: E2E_ENVIRONMENT is not set or not one of the three names. The suite does not guess.
export type OverridePolicy = 'allowed' | 'ignored' | 'unknown';

export function overridePolicy(env: Env = process.env): OverridePolicy {
  const name = env['E2E_ENVIRONMENT']?.trim() ?? '';
  if (name === 'test') return 'allowed';
  if (name === 'staging' || name === 'production') return 'ignored';
  return 'unknown';
}

// Returns the reason to skip a test, or undefined when the test must run.
// "allowed" is for a test that needs the override to work. "ignored" is for a test that needs it to be ignored.
// The text never prints a bad value of E2E_ENVIRONMENT. It names the environment only when it is a known name.
export function overrideSkipReason(expected: 'allowed' | 'ignored', env: Env = process.env): string | undefined {
  const policy = overridePolicy(env);
  if (policy === expected) return undefined;
  if (policy === 'unknown') {
    return 'E2E_ENVIRONMENT is not test, staging or production, so the suite cannot tell if the environment allows the override. Set E2E_ENVIRONMENT.';
  }
  if (policy === 'ignored') {
    return `only Test allows the override, and this run is against ${env['E2E_ENVIRONMENT']?.trim()}. Staging and Production ignore it on purpose.`;
  }
  return 'this check is for Staging and Production. Test allows the override, so a run against Test cannot show that it is ignored.';
}

interface ProductLike {
  readonly id: string;
  readonly discount?: unknown;
}

// The ids of the products that have no discount that is a number. Use it when the flag is on.
// An empty list gives an empty answer, so the test must also check that the list has products.
export function productsWithoutNumericDiscount(products: readonly ProductLike[]): string[] {
  return products.filter((product) => typeof product.discount !== 'number' || !Number.isFinite(product.discount)).map((product) => product.id);
}

// The ids of the products that carry the field discount, whatever its value. Use it when the flag is off:
// the field must be absent, not null and not 0.
export function productsWithDiscount(products: readonly ProductLike[]): string[] {
  return products.filter((product) => Object.hasOwn(product, 'discount')).map((product) => product.id);
}

// The ids of the products that break the expected state. When the flag is on, every product needs a numeric discount.
// When it is off, no product may carry the field discount. An empty list gives an empty answer,
// so the test must also check that the list has products.
export function discountProblems(products: readonly ProductLike[], expected: FlagValue): string[] {
  return expected === 'on' ? productsWithoutNumericDiscount(products) : productsWithDiscount(products);
}

// The number of discount elements that the page must show for a list of products: one for each when the flag is on.
export function expectedDiscountCount(expected: FlagValue, productCount: number): number {
  return expected === 'on' ? productCount : 0;
}
