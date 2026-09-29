import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BlockedAddressError,
  checkedLookup,
  createSafeDispatcher,
  dnsResolve,
  isPublicAddress,
  type Resolve,
} from '../src/fetch/address.js';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.215.14',
    '2606:4700:4700::1111',
    '2a00:1450:4001:80b::200e',
    '::ffff:8.8.8.8',
  ])('allows public %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['loopback (Lambda Runtime API)', '127.0.0.1'],
    ['loopback range', '127.255.255.254'],
    ['unspecified', '0.0.0.0'],
    ['"this network"', '0.1.2.3'],
    ['private 10/8', '10.0.0.1'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 172.31', '172.31.255.255'],
    ['private 192.168/16', '192.168.1.1'],
    ['link-local / cloud metadata', '169.254.169.254'],
    ['ECS task metadata', '169.254.170.2'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['IETF protocol assignments', '192.0.0.1'],
    ['documentation', '192.0.2.1'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 link-local with zone', 'fe80::1%eth0'],
    ['IPv6 unique local', 'fc00::1'],
    ['EC2 IPv6 metadata', 'fd00:ec2::254'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
    ['IPv4-mapped private', '::ffff:10.0.0.1'],
    ['NAT64 embedding a private IPv4', '64:ff9b::a00:1'],
    ['6to4 embedding a private IPv4', '2002:a00:1::'],
    ['Teredo', '2001::1'],
    ['discard prefix', '100::1'],
    ['not an address', 'localhost'],
    ['empty', ''],
  ])('refuses %s (%s)', (_, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

function lookupWith(resolve: Resolve, options: { all?: boolean; family?: number } = {}) {
  const lookup = checkedLookup(resolve, isPublicAddress);
  return new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
    (done) => {
      lookup('jobs.example.com', options, (error, address, family) =>
        done({ error, address, ...(family !== undefined ? { family } : {}) }),
      );
    },
  );
}

describe('checkedLookup', () => {
  it('returns the checked address', async () => {
    const result = await lookupWith(async () => [{ address: '8.8.8.8', family: 4 }]);
    expect(result).toEqual({ error: null, address: '8.8.8.8', family: 4 });
  });

  it('returns every address when Node asks for all (happy eyeballs)', async () => {
    const addresses = [
      { address: '2606:4700::1', family: 6 },
      { address: '8.8.8.8', family: 4 },
    ];
    const result = await lookupWith(async () => addresses, { all: true });
    expect(result.address).toEqual(addresses);
  });

  it('honours a requested family', async () => {
    const result = await lookupWith(
      async () => [
        { address: '2606:4700::1', family: 6 },
        { address: '8.8.8.8', family: 4 },
      ],
      { family: 4 },
    );
    expect(result.address).toBe('8.8.8.8');
  });

  it('refuses a name that resolves to a private address', async () => {
    const result = await lookupWith(async () => [{ address: '10.0.0.5', family: 4 }]);
    expect(result.error).toBeInstanceOf(BlockedAddressError);
  });

  it('refuses a name with any private address, even beside public ones', async () => {
    const result = await lookupWith(
      async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
      { all: true },
    );
    expect(result.error).toBeInstanceOf(BlockedAddressError);
  });

  it('reports a name with no addresses as not found', async () => {
    const result = await lookupWith(async () => []);
    expect(result.error?.code).toBe('ENOTFOUND');
  });

  it('passes DNS errors through', async () => {
    const failure: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND');
    failure.code = 'ENOTFOUND';
    const result = await lookupWith(async () => Promise.reject(failure));
    expect(result.error?.code).toBe('ENOTFOUND');
  });
});

describe('dnsResolve', () => {
  const failing = (code: string) => ({
    resolve4: async () => {
      const error: NodeJS.ErrnoException = new Error(code);
      error.code = code;
      throw error;
    },
  });

  it('returns IPv4 addresses', async () => {
    const resolve = dnsResolve({ resolve4: async () => ['8.8.8.8', '1.1.1.1'] });
    expect(await resolve('jobs.example.com')).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ]);
  });

  it.each([
    ['a name that does not exist', 'ENOTFOUND', 'ENOTFOUND'],
    ['a name without an IPv4 address', 'ENODATA', 'ENOTFOUND'],
    ['a DNS timeout (retriable)', 'ETIMEOUT', 'ETIMEOUT'],
    ['a server failure (retriable)', 'ESERVFAIL', 'ESERVFAIL'],
  ])('reports %s as %s', async (_, raw, code) => {
    await expect(dnsResolve(failing(raw))('jobs.example.com')).rejects.toMatchObject({ code });
  });
});

describe('createSafeDispatcher (real sockets)', () => {
  let server: Server;
  let port: number;
  const LOCAL = '127.0.0.1';

  beforeAll(async () => {
    server = createServer((_, res) => res.end('reached'));
    await new Promise<void>((resolve) => server.listen(0, LOCAL, resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const timeouts = { connectTimeoutMs: 2_000, idleTimeoutMs: 2_000 };

  it('never connects to loopback with the real address rules', async () => {
    const dispatcher = createSafeDispatcher({
      ...timeouts,
      resolve: async () => [{ address: LOCAL, family: 4 }],
    });
    const error = await fetch(`http://jobs.example.com:${port}/`, { dispatcher }).catch(
      (e: Error) => e,
    );
    expect((error as Error).cause).toBeInstanceOf(BlockedAddressError);
    await dispatcher.close();
  });

  it('refuses an IP literal before connecting (no lookup happens for literals)', async () => {
    const dispatcher = createSafeDispatcher(timeouts);
    const error = await fetch(`http://${LOCAL}:${port}/`, { dispatcher }).catch((e: Error) => e);
    expect((error as Error).cause).toBeInstanceOf(BlockedAddressError);
    const v6 = await fetch(`http://[::1]:${port}/`, { dispatcher }).catch((e: Error) => e);
    expect((v6 as Error).cause).toBeInstanceOf(BlockedAddressError);
    await dispatcher.close();
  });

  it('connects only to the address it checked (DNS rebinding has no second lookup)', async () => {
    // First answer: an address the test allows. Any later answer: a forbidden one. A
    // client that resolved twice (check, then connect) would be caught by the second answer.
    let lookups = 0;
    const dispatcher = createSafeDispatcher({
      ...timeouts,
      resolve: async () => {
        lookups += 1;
        return [{ address: lookups === 1 ? LOCAL : '10.0.0.1', family: 4 }];
      },
      isAllowed: (address) => address === LOCAL,
    });
    const response = await fetch(`http://rebind.example.com:${port}/`, { dispatcher });
    expect(await response.text()).toBe('reached');
    expect(lookups).toBe(1);
    await dispatcher.close();
  });

  it('checks again for a new connection, so a rebound name is refused then', async () => {
    let lookups = 0;
    const dispatcher = createSafeDispatcher({
      ...timeouts,
      resolve: async () => {
        lookups += 1;
        return [{ address: lookups === 1 ? LOCAL : '10.0.0.1', family: 4 }];
      },
      isAllowed: (address) => address === LOCAL,
    });
    await (await fetch(`http://rebind.example.com:${port}/`, { dispatcher })).text();
    const other = await fetch(`http://rebind2.example.com:${port}/`, { dispatcher }).catch(
      (e: Error) => e,
    );
    expect((other as Error).cause).toBeInstanceOf(BlockedAddressError);
    await dispatcher.close();
  });
});
