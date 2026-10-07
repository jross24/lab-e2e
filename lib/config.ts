// The base URLs of the three public applications. The tests never call AWS. The workflow reads the URLs
// from SSM and passes them in as environment variables.

export interface Urls {
  readonly web: string;
  readonly catalogue: string;
  readonly account: string;
}

const VARIABLES = {
  web: 'WEB_URL',
  catalogue: 'CATALOGUE_URL',
  account: 'ACCOUNT_URL',
} as const satisfies Record<keyof Urls, string>;

type Env = Readonly<Record<string, string | undefined>>;

// Returns the URL without trailing slashes, or undefined if the text is not an http or https URL.
function clean(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.hostname === '' || url.username !== '' || url.password !== '') return undefined;
  return text.replace(/\/+$/, '');
}

// Reads the URLs when the code calls it, not when the module loads. So "playwright test --list" works
// with no URL set. One error names all the problems. It never prints the value of a bad variable.
export function readUrls(env: Env = process.env): Urls {
  const problems: string[] = [];
  const urls: Partial<Record<keyof Urls, string>> = {};

  for (const [key, name] of Object.entries(VARIABLES) as [keyof Urls, string][]) {
    const value = env[name]?.trim();
    if (!value) {
      problems.push(`${name} is not set`);
      continue;
    }
    const url = clean(value);
    if (url === undefined) {
      problems.push(`${name} is not an http or https URL`);
      continue;
    }
    urls[key] = url;
  }

  if (problems.length > 0) {
    throw new Error(`The test needs the base URL of each application. ${problems.join('. ')}.`);
  }
  return urls as Urls;
}
