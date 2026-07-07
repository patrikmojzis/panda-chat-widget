export type AllowedDomainRecord = {
  domain: string;
  enabled: boolean;
};

export type AllowedDomainInputInvalidReason = 'missing_domain' | 'invalid_domain';

export type AllowedDomainInputResult =
  | {
      status: 'valid';
      domain: string;
    }
  | {
      status: 'invalid';
      reason: AllowedDomainInputInvalidReason;
    };

export type OriginDomainMatchResult =
  | {
      allowed: true;
      origin: string;
      hostname: string;
      domain: string;
    }
  | {
      allowed: false;
      reason: 'missing_origin' | 'invalid_origin' | 'domain_not_allowed';
    };

export function matchOriginToAllowedDomains(
  origin: string | null | undefined,
  allowedDomains: readonly AllowedDomainRecord[],
): OriginDomainMatchResult {
  const parsedOrigin = parseHttpOrigin(origin);

  if (!parsedOrigin) {
    if (origin === undefined || origin === null || origin.trim().length === 0) {
      return { allowed: false, reason: 'missing_origin' };
    }

    return { allowed: false, reason: 'invalid_origin' };
  }

  const matchedDomain = allowedDomains.find(
    (allowedDomain) => allowedDomain.enabled && normalizeDomain(allowedDomain.domain) === parsedOrigin.hostname,
  );

  if (!matchedDomain) {
    return { allowed: false, reason: 'domain_not_allowed' };
  }

  return {
    allowed: true,
    origin: parsedOrigin.origin,
    hostname: parsedOrigin.hostname,
    domain: normalizeDomain(matchedDomain.domain),
  };
}

export function normalizeAllowedDomainInput(input: unknown): AllowedDomainInputResult {
  if (input === undefined || input === null) {
    return { status: 'invalid', reason: 'missing_domain' };
  }

  if (typeof input !== 'string') {
    return { status: 'invalid', reason: 'invalid_domain' };
  }

  const rawDomain = input.trim();

  if (rawDomain.length === 0) {
    return { status: 'invalid', reason: 'missing_domain' };
  }

  const schemefulOrigin = parseHttpOrigin(rawDomain);

  if (schemefulOrigin) {
    return { status: 'valid', domain: schemefulOrigin.hostname };
  }

  if (hasUrlScheme(rawDomain)) {
    return { status: 'invalid', reason: 'invalid_domain' };
  }

  if (rawDomain.includes(':')) {
    return { status: 'invalid', reason: 'invalid_domain' };
  }

  if (!isAllowedHostnameText(rawDomain)) {
    return { status: 'invalid', reason: 'invalid_domain' };
  }

  const domain = normalizeDomain(rawDomain);

  return isAllowedHostname(domain)
    ? { status: 'valid', domain }
    : { status: 'invalid', reason: 'invalid_domain' };
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

type ParsedOrigin = {
  origin: string;
  hostname: string;
};

function parseHttpOrigin(origin: string | null | undefined): ParsedOrigin | undefined {
  if (origin === undefined || origin === null) {
    return undefined;
  }

  const rawOrigin = origin.trim();

  if (rawOrigin.length === 0) {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(rawOrigin);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }

  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return undefined;
  }

  const hostname = normalizeDomain(parsed.hostname);

  if (hostname.length === 0 || !isAllowedHostname(hostname)) {
    return undefined;
  }

  return {
    origin: parsed.origin,
    hostname,
  };
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function isAllowedHostnameText(value: string): boolean {
  return !/[\s/@?#<>"'`,]/.test(value);
}

function isAllowedHostname(hostname: string): boolean {
  if (hostname === 'localhost') {
    return true;
  }

  if (isBracketedIpv6Hostname(hostname)) {
    return true;
  }

  if (/^\d+(?:\.\d+){3}$/.test(hostname)) {
    return isIpv4Address(hostname);
  }

  return isDnsHostname(hostname);
}

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split('.');

  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const octet = Number(part);

    return octet >= 0 && octet <= 255 && String(octet) === part;
  });
}

function isBracketedIpv6Hostname(hostname: string): boolean {
  return /^\[[0-9a-f:.]+\]$/i.test(hostname) && hostname.includes(':');
}

function isDnsHostname(hostname: string): boolean {
  if (hostname.length > 253 || hostname.startsWith('.') || hostname.endsWith('.')) {
    return false;
  }

  const labels = hostname.split('.');

  return labels.every((label) =>
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  );
}
