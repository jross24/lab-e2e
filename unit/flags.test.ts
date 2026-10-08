import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OVERRIDE_HEADER,
  OVERRIDE_VALUE,
  overridePolicy,
  overrideSkipReason,
  productsWithDiscount,
  productsWithoutNumericDiscount,
} from '../lib/flags.ts';

describe('the override request', () => {
  it('turns on the flag show-discounts through the header x-lab-flags', () => {
    assert.equal(OVERRIDE_HEADER, 'x-lab-flags');
    assert.equal(OVERRIDE_VALUE, 'show-discounts=on');
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
