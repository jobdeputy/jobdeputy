import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../lib/build-app.js';
import { webSignInParameter } from '../lib/cell-stack.js';

// Prod once the store item exists: an extension client (so managed login), but no site yet.
vi.mock('@jobdeputy/shared/extension', async (original) => ({
  ...(await original<typeof import('@jobdeputy/shared/extension')>()),
  EXTENSION_STORE_IDS: ['abcdefghijklmnopabcdefghijklmnop'],
}));

describe("the site's config (#111)", () => {
  it('names managed login only where the web client may sign in there', () => {
    const prod = Template.fromStack(
      buildApp({ stage: 'prod', env: {} }).node.findChild('jobdeputy-prod-iad') as never,
    );
    // Managed login exists (the extension's)…
    expect(Object.keys(prod.findOutputs('AuthDomain'))).toEqual(['AuthDomain']);
    // …but the web client has no sign-in there, so the app says it isn't available.
    const config = Object.values(prod.findResources('AWS::SSM::Parameter')).find(
      (r) => r.Properties.Name === webSignInParameter('prod', 'iad'),
    );
    expect(config).toBeDefined();
    expect(JSON.stringify(config?.Properties.Value)).not.toContain('authDomain');
  });
});
