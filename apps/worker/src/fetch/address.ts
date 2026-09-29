import { Resolver } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, buildConnector } from 'undici';

/**
 * SSRF protection at the socket (0007). The address a connection is opened to must be
 * public unicast. The check runs inside the connection's own DNS lookup, and the socket
 * connects to exactly the addresses checked, so DNS rebinding (public on a first lookup,
 * private on a second) has no second lookup to exploit.
 */

/** A connection was refused because the name resolved to a non-public address. */
export class BlockedAddressError extends Error {
  override name = 'BlockedAddressError';
  readonly code = 'ERR_BLOCKED_ADDRESS';
}

/**
 * True only for public unicast addresses. Everything else is refused: loopback (the Lambda
 * Runtime API is on 127.0.0.1), private, link-local (cloud metadata), carrier-grade NAT,
 * multicast, reserved, documentation, and IPv6 forms that embed an IPv4 address (mapped,
 * NAT64, 6to4, Teredo). IPv4-mapped IPv6 is judged by the IPv4 address inside it.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  return parsed.range() === 'unicast';
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolve = (hostname: string) => Promise<ResolvedAddress[]>;

/** The part of Node's DNS resolver we use (injectable for tests). */
export interface Resolve4 {
  resolve4(hostname: string): Promise<string[]>;
}

/**
 * Asks DNS directly (c-ares), for IPv4 only:
 * - A Lambda outside a VPC has no IPv6 route, so IPv4 is all it can connect to.
 * - Unlike the system lookup (`getaddrinfo`), which in Lambda reports a non-existent
 *   name as an ambiguous `EBUSY`, it answers `ENOTFOUND` for a name that does not
 *   exist and `ENODATA` for one without an IPv4 address: both final, so never retried.
 * - It skips the local hosts file and does not use libuv's small thread pool.
 */
export function dnsResolve(resolver: Resolve4): Resolve {
  return async (hostname) => {
    try {
      return (await resolver.resolve4(hostname)).map((address) => ({ address, family: 4 }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENODATA') {
        throw notFound(`${hostname} has no IPv4 address`);
      }
      throw error;
    }
  };
}

export const systemResolve: Resolve = dnsResolve(new Resolver({ timeout: 3_000, tries: 2 }));

/**
 * A `net.connect` lookup that refuses the whole connection if **any** address the name
 * resolves to is not allowed (a name pointing at both a public and a private address is
 * suspicious, and Node may try either).
 */
export function checkedLookup(
  resolve: Resolve,
  isAllowed: (address: string) => boolean,
): LookupFunction {
  async function check(hostname: string, family: number): Promise<ResolvedAddress[]> {
    const addresses = await resolve(hostname);
    if (addresses.length === 0) throw notFound(`No addresses for ${hostname}`);
    if (addresses.some((a) => !isAllowed(a.address))) {
      throw new BlockedAddressError(`${hostname} resolves to a non-public address`);
    }
    const usable = family === 0 ? addresses : addresses.filter((a) => a.family === family);
    if (usable.length === 0) throw notFound(`No IPv${family} address for ${hostname}`);
    return usable;
  }

  return (hostname, options, callback) => {
    const family = options.family === 4 || options.family === 6 ? options.family : 0;
    check(hostname, family).then(
      (usable) => {
        const [first] = usable as [ResolvedAddress];
        if (options.all) callback(null, usable);
        else callback(null, first.address, first.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ''),
    );
  };
}

function notFound(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = 'ENOTFOUND';
  return error;
}

export interface SafeDispatcherOptions {
  /** Tests only: a fake DNS. */
  resolve?: Resolve;
  /** Tests only: allow a local test server. */
  isAllowed?: (address: string) => boolean;
  connectTimeoutMs: number;
  /** Idle limits between bytes; the fetcher's overall deadline is the real cap. */
  idleTimeoutMs: number;
}

/** An undici dispatcher that can only open connections to allowed addresses. */
export function createSafeDispatcher(options: SafeDispatcherOptions): Agent {
  const isAllowed = options.isAllowed ?? isPublicAddress;
  const connectToCheckedAddress = buildConnector({
    timeout: options.connectTimeoutMs,
    lookup: checkedLookup(options.resolve ?? systemResolve, isAllowed),
  });
  return new Agent({
    connect(connectOptions, callback) {
      // Node skips the lookup for IP literals. The URL rules already refuse them; this
      // keeps the socket safe even if a literal ever got this far.
      const host = connectOptions.hostname.replace(/^\[|\]$/g, '');
      if (isIP(host) !== 0 && !isAllowed(host)) {
        callback(new BlockedAddressError(`${host} is not a public address`), null);
        return;
      }
      connectToCheckedAddress(connectOptions, callback);
    },
    headersTimeout: options.idleTimeoutMs,
    bodyTimeout: options.idleTimeoutMs,
  });
}
