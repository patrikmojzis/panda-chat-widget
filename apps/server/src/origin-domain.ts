export type AllowedDomainRecord = {
  domain: string;
  enabled: boolean;
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

  if (hostname.length === 0) {
    return undefined;
  }

  return {
    origin: parsed.origin,
    hostname,
  };
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}
