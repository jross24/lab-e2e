import type { Page } from '@playwright/test';
import { APPLICATIONS } from './versions.ts';
import type { Versions } from './versions.ts';

// The data-testid of each version on the page of web. See the README of lab-web.
export const VERSION_TEST_IDS = {
  web: 'web-version',
  catalogue: 'catalogue-version',
  account: 'account-version',
  core: 'core-version',
} as const satisfies Versions;

export async function readPageVersions(page: Page): Promise<Versions> {
  const entries = await Promise.all(
    APPLICATIONS.map(async (name) => {
      const text = await page.getByTestId(VERSION_TEST_IDS[name]).innerText({ timeout: 5_000 });
      return [name, text.trim()] as const;
    }),
  );
  return Object.fromEntries(entries) as Versions;
}
