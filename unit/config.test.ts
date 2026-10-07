import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readUrls } from '../lib/config.ts';

const valid = {
  WEB_URL: 'https://web.example.test',
  CATALOGUE_URL: 'https://catalogue.example.test',
  ACCOUNT_URL: 'https://account.example.test',
};

describe('readUrls', () => {
  it('returns the three URLs', () => {
    assert.deepEqual(readUrls(valid), {
      web: 'https://web.example.test',
      catalogue: 'https://catalogue.example.test',
      account: 'https://account.example.test',
    });
  });

  it('removes trailing slashes, so a path can be added with a slash', () => {
    const urls = readUrls({ ...valid, WEB_URL: 'https://web.example.test/', ACCOUNT_URL: 'https://a.example.test/stage//' });
    assert.equal(urls.web, 'https://web.example.test');
    assert.equal(urls.account, 'https://a.example.test/stage');
  });

  it('accepts http, for a local test server', () => {
    assert.equal(readUrls({ ...valid, WEB_URL: 'http://localhost:3000' }).web, 'http://localhost:3000');
  });

  it('names every missing variable in one message', () => {
    assert.throws(() => readUrls({ CATALOGUE_URL: valid.CATALOGUE_URL }), (error: Error) => {
      assert.match(error.message, /WEB_URL is not set/);
      assert.match(error.message, /ACCOUNT_URL is not set/);
      assert.doesNotMatch(error.message, /CATALOGUE_URL is not set/);
      return true;
    });
  });

  it('treats an empty value as not set', () => {
    assert.throws(() => readUrls({ ...valid, WEB_URL: '  ' }), /WEB_URL is not set/);
  });

  for (const bad of ['web.example.test', 'ftp://web.example.test', 'https://', 'not a url']) {
    it(`rejects "${bad}"`, () => {
      assert.throws(() => readUrls({ ...valid, WEB_URL: bad }), /WEB_URL is not an http or https URL/);
    });
  }

  it('does not repeat the value of a bad variable', () => {
    assert.throws(() => readUrls({ ...valid, WEB_URL: 'ftp://secret-looking-value' }), (error: Error) => {
      assert.doesNotMatch(error.message, /secret-looking-value/);
      return true;
    });
  });

  it('rejects a URL with a user name or password', () => {
    assert.throws(() => readUrls({ ...valid, WEB_URL: 'https://user:pass@web.example.test' }), /WEB_URL is not an http or https URL/);
  });
});
