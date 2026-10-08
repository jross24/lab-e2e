import { test } from '@playwright/test';
import { drillFailure } from '../lib/drill.ts';

// The fault drill. The owner of a service repository sets the repository variable E2E_FAULT_DRILL
// to prove that a failing suite stops the release. See lib/drill.ts and the README.
// The test is part of the smoke subset, so it runs in both suites. It calls no application.
// With the variable empty or naming another run, it passes.
test('the fault drill is off', { tag: '@smoke' }, () => {
  const failure = drillFailure();
  if (failure !== undefined) throw new Error(failure);
});
