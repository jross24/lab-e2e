// The feature flag show-discounts. The suite tests both of its states in every run.
//
// The flag is off in every environment. In Test only, the request header x-lab-flags can turn it on
// for that one request. Staging and Production ignore the header. So Test is the one place where the
// "on" state can run, and the suite tests it there on every release.
//
// The functions here are pure, so the unit tests need no network and no browser.

export const FLAG_NAME = 'show-discounts';
export const OVERRIDE_HEADER = 'x-lab-flags';
export const OVERRIDE_VALUE = `${FLAG_NAME}=on`;

// The tests mark themselves with an annotation of this type. The summary reporter reads it,
// so the summary can say which states of the flag the run tested.
export const FLAG_ANNOTATION = 'flag-state';

// default: the flag as the environment sets it, with no header. This is the state of Production.
// override-on: a request with the header, in an environment that allows it.
// override-ignored: a request with the header, in an environment that must ignore it.
export const FLAG_STATES = ['default', 'override-on', 'override-ignored'] as const;
export type FlagState = (typeof FLAG_STATES)[number];

export function isFlagState(value: unknown): value is FlagState {
  return FLAG_STATES.some((state) => state === value);
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
