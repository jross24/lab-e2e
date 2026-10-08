import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  FLAG_NAME,
  OVERRIDE_HEADER,
  STATE_PARAMETER,
  STATE_VARIABLE,
  discountProblems,
  expectedDiscountCount,
  oppositeOverrideHeaders,
  oppositeState,
  overrideHeaders,
  overridePolicy,
  overrideSkipReason,
  parseDeclaredState,
  productsWithDiscount,
  productsWithoutNumericDiscount,
  readDeclaredState,
} from '../lib/flags.ts';

describe('the declared state', () => {
  it('reads on and off from the variable', () => {
    assert.equal(STATE_VARIABLE, 'E2E_FLAG_SHOW_DISCOUNTS');
    assert.equal(readDeclaredState({ E2E_FLAG_SHOW_DISCOUNTS: 'on' }), 'on');
    assert.equal(readDeclaredState({ E2E_FLAG_SHOW_DISCOUNTS: 'off' }), 'off');
  });

  it('ignores spaces and a newline around the value', () => {
    assert.equal(parseDeclaredState(' on\n'), 'on');
    assert.equal(parseDeclaredState('off '), 'off');
  });

  it('accepts only the words on and off', () => {
    for (const value of [undefined, '', 'ON', 'Off', 'true', 'false', '1', '0', 'yes', 'on off']) {
      assert.equal(parseDeclaredState(value), undefined, String(value));
    }
  });

  it('fails with a clear message when the variable is not set', () => {
    assert.throws(
      () => readDeclaredState({}),
      (error: Error) => {
        assert.match(error.message, /E2E_FLAG_SHOW_DISCOUNTS is not set/);
        assert.ok(error.message.includes(STATE_PARAMETER), 'the message names the SSM parameter');
        return true;
      },
    );
    assert.throws(() => readDeclaredState({ E2E_FLAG_SHOW_DISCOUNTS: '' }), /is not set/);
  });

  it('fails with a clear message when the value is not on or off, and never prints the value', () => {
    assert.throws(
      () => readDeclaredState({ E2E_FLAG_SHOW_DISCOUNTS: 'secret-value' }),
      (error: Error) => {
        assert.match(error.message, /E2E_FLAG_SHOW_DISCOUNTS must be on or off/);
        assert.doesNotMatch(error.message, /secret-value/);
        return true;
      },
    );
  });

  it('is the SSM parameter /lab/flags/state/show-discounts', () => {
    assert.equal(FLAG_NAME, 'show-discounts');
    assert.equal(STATE_PARAMETER, '/lab/flags/state/show-discounts');
  });

  it('is passed on by the suite action with the same variable and the same parameter', () => {
    const action = readFileSync(new URL('../actions/suite/action.yml', import.meta.url), 'utf8');
    assert.ok(action.includes(STATE_PARAMETER), 'the action reads the parameter');
    assert.ok(action.includes(`${STATE_VARIABLE}:`), 'the action passes the variable to the run step');
  });
});

describe('oppositeState', () => {
  it('turns on into off and off into on', () => {
    assert.equal(oppositeState('on'), 'off');
    assert.equal(oppositeState('off'), 'on');
  });
});

describe('the override request', () => {
  it('asks for a state through the header x-lab-flags', () => {
    assert.equal(OVERRIDE_HEADER, 'x-lab-flags');
    assert.deepEqual(overrideHeaders('on'), { 'x-lab-flags': 'show-discounts=on' });
    assert.deepEqual(overrideHeaders('off'), { 'x-lab-flags': 'show-discounts=off' });
  });

  it('asks for off when the flag is declared on', () => {
    assert.deepEqual(oppositeOverrideHeaders('on'), { 'x-lab-flags': 'show-discounts=off' });
  });

  it('asks for on when the flag is declared off', () => {
    assert.deepEqual(oppositeOverrideHeaders('off'), { 'x-lab-flags': 'show-discounts=on' });
  });
});

describe('discountProblems', () => {
  const products = [{ id: 'a', discount: 10 }, { id: 'b', discount: 0 }];
  const bare = [{ id: 'a' }, { id: 'b' }];

  it('for the state on, returns the products that have no numeric discount', () => {
    assert.deepEqual(discountProblems(products, 'on'), []);
    assert.deepEqual(discountProblems([...products, { id: 'c' }, { id: 'd', discount: null }], 'on'), ['c', 'd']);
  });

  it('for the state off, returns the products that have the field discount, even 0 or null', () => {
    assert.deepEqual(discountProblems(bare, 'off'), []);
    assert.deepEqual(discountProblems([{ id: 'a' }, { id: 'b', discount: 0 }, { id: 'c', discount: null }], 'off'), ['b', 'c']);
  });

  it('fails a list with discounts for the state off and a bare list for the state on', () => {
    assert.deepEqual(discountProblems(products, 'off'), ['a', 'b']);
    assert.deepEqual(discountProblems(bare, 'on'), ['a', 'b']);
  });
});

describe('expectedDiscountCount', () => {
  it('is one for each product when the flag is on and none when it is off', () => {
    assert.equal(expectedDiscountCount('on', 6), 6);
    assert.equal(expectedDiscountCount('off', 6), 0);
  });
});

describe('overridePolicy', () => {
  it('allows the override in Test only', () => {
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: 'test' }), 'allowed');
  });

  it('says that Staging and Production ignore the override', () => {
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: 'staging' }), 'ignored');
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: 'production' }), 'ignored');
  });

  it('does not guess when the environment is unknown, empty or misspelled', () => {
    assert.equal(overridePolicy({}), 'unknown');
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: '' }), 'unknown');
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: 'prod' }), 'unknown');
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: 'Test' }), 'unknown');
  });

  it('ignores spaces around the name', () => {
    assert.equal(overridePolicy({ E2E_ENVIRONMENT: ' test\n' }), 'allowed');
  });
});

describe('overrideSkipReason', () => {
  it('lets a test that needs the override run in Test', () => {
    assert.equal(overrideSkipReason('allowed', { E2E_ENVIRONMENT: 'test' }), undefined);
  });

  it('lets a test that needs an ignored override run in Staging and Production', () => {
    assert.equal(overrideSkipReason('ignored', { E2E_ENVIRONMENT: 'staging' }), undefined);
    assert.equal(overrideSkipReason('ignored', { E2E_ENVIRONMENT: 'production' }), undefined);
  });

  it('skips an override test outside Test and names the environment', () => {
    const reason = overrideSkipReason('allowed', { E2E_ENVIRONMENT: 'production' });
    assert.match(reason ?? '', /only Test allows the override/);
    assert.match(reason ?? '', /production/);
  });

  it('skips the ignored-override test in Test and names the environment', () => {
    const reason = overrideSkipReason('ignored', { E2E_ENVIRONMENT: 'test' });
    assert.match(reason ?? '', /Test allows the override/);
    assert.match(reason ?? '', /Staging and Production/);
  });

  it('skips both tests when the environment is unknown and names the variable', () => {
    assert.match(overrideSkipReason('allowed', {}) ?? '', /E2E_ENVIRONMENT/);
    assert.match(overrideSkipReason('ignored', {}) ?? '', /E2E_ENVIRONMENT/);
  });

  it('never prints the value of a bad variable', () => {
    assert.doesNotMatch(overrideSkipReason('allowed', { E2E_ENVIRONMENT: 'secret-value' }) ?? '', /secret-value/);
  });
});

describe('productsWithoutNumericDiscount', () => {
  it('returns nothing when every product has a number', () => {
    assert.deepEqual(productsWithoutNumericDiscount([{ id: 'a', discount: 10 }, { id: 'b', discount: 0 }]), []);
  });

  it('returns the ids of products with no discount, a text or a null', () => {
    const products = [
      { id: 'a', discount: 10 },
      { id: 'b' },
      { id: 'c', discount: '10' },
      { id: 'd', discount: null },
      { id: 'e', discount: Number.NaN },
    ];
    assert.deepEqual(productsWithoutNumericDiscount(products), ['b', 'c', 'd', 'e']);
  });

  it('returns nothing for an empty list, so the test must check the length itself', () => {
    assert.deepEqual(productsWithoutNumericDiscount([]), []);
  });
});

describe('productsWithDiscount', () => {
  it('returns nothing when no product has the field', () => {
    assert.deepEqual(productsWithDiscount([{ id: 'a' }, { id: 'b' }]), []);
  });

  it('returns the ids of products that have the field, whatever the value', () => {
    const products = [{ id: 'a' }, { id: 'b', discount: 10 }, { id: 'c', discount: null }, { id: 'd', discount: 0 }];
    assert.deepEqual(productsWithDiscount(products), ['b', 'c', 'd']);
  });
});
