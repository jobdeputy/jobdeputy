import { describe, expect, it, vi } from 'vitest';
import { cognitoEmailLookup } from '../src/cognito.js';

describe('cognitoEmailLookup', () => {
  it('returns the email attribute', async () => {
    const send = vi.fn(async () => ({
      UserAttributes: [{ Name: 'email', Value: 'a@example.com' }],
    }));
    await expect(cognitoEmailLookup('pool', { send } as never)('name')).resolves.toBe(
      'a@example.com',
    );
  });

  it('returns undefined once the login is deleted (a token can outlive its user)', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('gone'), { name: 'UserNotFoundException' });
    });
    await expect(cognitoEmailLookup('pool', { send } as never)('name')).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
    });
    await expect(cognitoEmailLookup('pool', { send } as never)('name')).rejects.toThrow(
      'throttled',
    );
  });
});
