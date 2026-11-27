import { describe, expect, it } from 'vitest';
import { readSettings } from '../src/settings.ts';

const env = {
  WXT_API_URL: 'https://abc.execute-api.us-east-1.amazonaws.com/',
  WXT_AUTH_DOMAIN: 'https://jobdeputy-dev-iad.auth.us-east-1.amazoncognito.com',
  WXT_CLIENT_ID: '37qq0qiq6rckk23cg85qi6m4bs',
};

describe('readSettings (#54)', () => {
  it('reads the build settings, without a trailing slash', () => {
    expect(readSettings({ ...env, WXT_SITE_URL: 'https://dev.jobdeputy.com/' })).toEqual({
      apiUrl: 'https://abc.execute-api.us-east-1.amazonaws.com',
      authDomain: 'https://jobdeputy-dev-iad.auth.us-east-1.amazoncognito.com',
      clientId: '37qq0qiq6rckk23cg85qi6m4bs',
      siteUrl: 'https://dev.jobdeputy.com',
    });
  });

  it('is null without every sign-in setting, or with one that is not plain https', () => {
    expect(readSettings({})).toBeNull();
    for (const [key, bad] of [
      ['WXT_API_URL', 'http://abc.example.com'],
      ['WXT_API_URL', 'https://abc.example.com/?x=1'],
      ['WXT_API_URL', 'https://:secret@abc.example.com'],
      ['WXT_API_URL', 'https://user@abc.example.com'],
      ['WXT_AUTH_DOMAIN', 'not a url'],
      ['WXT_AUTH_DOMAIN', ''],
      ['WXT_CLIENT_ID', 'short'],
      ['WXT_CLIENT_ID', 'UPPER-and-dashes-are-not-a-client-id'],
    ] as const) {
      expect(readSettings({ ...env, [key]: bad }), `${key}=${bad}`).toBeNull();
    }
  });

  it('leaves the site out when it is missing or not https', () => {
    expect(readSettings(env)?.siteUrl).toBeUndefined();
    expect(
      readSettings({ ...env, WXT_SITE_URL: 'http://localhost:5173' })?.siteUrl,
    ).toBeUndefined();
  });
});
