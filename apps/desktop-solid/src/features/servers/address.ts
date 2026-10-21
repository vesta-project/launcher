// Client-side reading of what the user typed or pasted into "Server address".
// It gives immediate feedback and pre-fills pairing; the native side parses and
// validates again before any network work.
import { normalizeFingerprint } from './fingerprint';

export const DEFAULT_PORT = 8443;

export interface ParsedAddress {
  kind: 'address';
  host: string;
  port: number;
  /** `host:port`, with IPv6 hosts in brackets. */
  display: string;
}

export interface ParsedPairingLink {
  kind: 'link';
  address: ParsedAddress;
  code: string | null;
  fingerprint: string | null;
  serverId: string | null;
}

export type AddressProblem = 'empty' | 'scheme' | 'credentials' | 'path' | 'host' | 'port' | 'link';
export type AddressResult = ParsedAddress | ParsedPairingLink | { kind: 'invalid'; problem: AddressProblem };

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const invalid = (problem: AddressProblem) => ({ kind: 'invalid' as const, problem });

function hostname(value: string) {
  if (IPV4.test(value)) return true;
  if (value.length > 253 || /^\d+(\.\d+)*$/.test(value)) return false;
  return value.split('.').every((label) => HOST_LABEL.test(label));
}

function ipv6(value: string) {
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(':')) return false;
  try { new URL(`https://[${value}]/`); return true; } catch { return false; }
}

const shown = (host: string, port: number) => `${host.includes(':') ? `[${host}]` : host}:${port}`;

/** Parses `host`, `host:port`, `[v6]:port`, `https://host:port` (no path, no credentials). */
export function parseHostPort(input: string): ParsedAddress | { kind: 'invalid'; problem: AddressProblem } {
  let value = input.trim();
  if (!value) return invalid('empty');
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
  if (scheme) {
    if (scheme[1].toLowerCase() !== 'https') return invalid('scheme');
    value = value.slice(scheme[0].length);
    if (value.includes('@')) return invalid('credentials');
    const end = value.search(/[/?#]/);
    if (end >= 0) {
      if (!/^\/?$/.test(value.slice(end))) return invalid('path');
      value = value.slice(0, end);
    }
  } else if (/[/?#@\s]/.test(value)) {
    return invalid(value.includes('@') ? 'credentials' : 'path');
  }

  let host = value;
  let port = DEFAULT_PORT;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (bracketed) {
    host = bracketed[1];
    if (!ipv6(host)) return invalid('host');
    if (bracketed[2] !== undefined) port = Number(bracketed[2]);
  } else if ((value.match(/:/g) ?? []).length > 1) {
    // A bare IPv6 literal without brackets cannot carry a port.
    if (!ipv6(value)) return invalid('host');
  } else {
    const at = value.lastIndexOf(':');
    if (at >= 0) {
      host = value.slice(0, at);
      if (!/^\d{1,5}$/.test(value.slice(at + 1))) return invalid('port');
      port = Number(value.slice(at + 1));
    }
    host = host.toLowerCase();
    if (!hostname(host)) return invalid('host');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return invalid('port');
  return { kind: 'address', host, port, display: shown(host, port) };
}

/** `vesta://pair?endpoint=<https url>&code=<code>&fp=<sha256>&sid=<server id>` from `vesta-agent pair`. */
export function parseAddressInput(input: string): AddressResult {
  const value = input.trim();
  if (!/^vesta:\/\//i.test(value)) return parseHostPort(value);
  let url: URL;
  try { url = new URL(value); } catch { return invalid('link'); }
  if (url.host.toLowerCase() !== 'pair' && url.pathname.replace(/^\/+/, '').toLowerCase() !== 'pair') return invalid('link');
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint) return invalid('link');
  const address = parseHostPort(endpoint);
  if (address.kind === 'invalid') return address;
  const fp = url.searchParams.get('fp');
  const fingerprint = fp ? normalizeFingerprint(fp) : null;
  if (fp && !fingerprint) return invalid('link');
  return {
    kind: 'link',
    address,
    code: url.searchParams.get('code')?.trim() || null,
    fingerprint,
    serverId: url.searchParams.get('sid')?.trim() || null,
  };
}

/** Pairing codes are 32 random bytes in unpadded base64url (43 characters). */
export function normalizePairingCode(input: string) {
  return input.replace(/\s+/g, '');
}

export const isPairingCode = (input: string) => /^[A-Za-z0-9_-]{43}$/.test(normalizePairingCode(input));
