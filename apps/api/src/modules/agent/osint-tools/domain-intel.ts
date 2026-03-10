/**
 * Domain Intelligence Module
 *
 * Collects intelligence about a domain using public sources.
 *
 * Current providers:
 * - RDAP (registration data)
 * - crt.sh (certificate transparency logs)
 *
 * Planned providers:
 * - VirusTotal
 * - SecurityTrails
 */

export interface DomainIntelResult {
  /** Domain that was queried */
  domain: string;

  /** Whether the domain format is valid */
  isValid: boolean;

  /** Domain registrar */
  registrar: string | null;

  /** Domain registration date */
  registeredOn: string | null;

  /** Domain expiration date */
  expiresOn: string | null;

  /** Last update date */
  updatedOn: string | null;

  /** Authoritative name servers */
  nameServers: string[];

  /** Domain status flags */
  status: string[];

  /** Discovered subdomains */
  subdomains: string[];

  /** DNS records */
  dns: {
    a: string[];
    mx: string[];
    txt: string[];
  };

  /** Raw provider responses */
  raw: {
    rdap?: RdapResponse | null;
    crtsh?: string[];
  };
}

/**
 * RDAP response shape (partial)
 */
interface RdapResponse {
  events?: {
    eventAction: string;
    eventDate: string;
  }[];

  status?: string[];

  nameservers?: {
    ldhName: string;
  }[];

  entities?: {
    roles?: string[];
    vcardArray?: unknown[];
  }[];
}

/**
 * crt.sh certificate entry
 */
interface CrtShEntry {
  name_value: string;
}

/**
 * Basic domain validation
 */
function isValidDomain(domain: string): boolean {
  const regex = /^(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,}$/;

  return regex.test(domain);
}

/**
 * Normalizes domain input by removing protocol and path.
 */
function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

/**
 * RDAP lookup
 */
async function rdapLookup(domain: string): Promise<RdapResponse | null> {
  try {
    const res = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`
    );

    if (!res.ok) return null;

    return (await res.json()) as RdapResponse;
  } catch {
    return null;
  }
}

/**
 * Queries crt.sh for certificate transparency logs
 * to discover subdomains.
 */
async function crtshLookup(domain: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`
    );

    if (!res.ok) return [];

    const data = (await res.json()) as CrtShEntry[];

    const subdomains = new Set<string>();

    for (const entry of data) {
      entry.name_value
        .split("\n")
        .map((s) => s.trim().toLowerCase().replace(/^\*\./, ""))
        .filter((s) => s.endsWith(domain) && s !== domain)
        .forEach((s) => subdomains.add(s));
    }

    return [...subdomains].slice(0, 50);
  } catch {
    return [];
  }
}

/**
 * Extracts event date from RDAP events
 */
function getEventDate(
  events: RdapResponse["events"] | undefined,
  action: string
): string | null {
  return events?.find((e) => e.eventAction === action)?.eventDate ?? null;
}

/**
 * Extracts registrar name from RDAP entities
 */
function extractRegistrar(entities: RdapResponse["entities"]): string | null {
  if (!entities) return null;

  const registrar = entities.find((e) => e.roles?.includes("registrar"));

  const vcard = registrar?.vcardArray as unknown[][] | undefined;

  const fnEntry = vcard?.[1]?.find((v) => Array.isArray(v) && v[0] === "fn");

  return (fnEntry as string[])?.[3] ?? null;
}

/**
 * Parses RDAP response into normalized fields.
 */
function parseRdap(
  rdap: RdapResponse,
  domain: string
): Partial<DomainIntelResult> {
  return {
    domain,
    isValid: true,
    registrar: extractRegistrar(rdap.entities),
    registeredOn: getEventDate(rdap.events, "registration"),
    expiresOn: getEventDate(rdap.events, "expiration"),
    updatedOn: getEventDate(rdap.events, "last changed"),
    nameServers: rdap.nameservers?.map((ns) => ns.ldhName?.toLowerCase()) ?? [],
    status: rdap.status ?? [],
  };
}

/**
 * Main domain intelligence function.
 *
 * Steps:
 * 1. Normalize input
 * 2. Validate domain format
 * 3. Query external providers
 * 4. Normalize results
 */
export async function runDomainIntel(
  domain: string
): Promise<DomainIntelResult> {
  const cleaned = normalizeDomain(domain);

  if (!isValidDomain(cleaned)) {
    return {
      domain: cleaned,
      isValid: false,
      registrar: null,
      registeredOn: null,
      expiresOn: null,
      updatedOn: null,
      nameServers: [],
      status: [],
      subdomains: [],
      dns: { a: [], mx: [], txt: [] },
      raw: {},
    };
  }

  const [rdapData, subdomains] = await Promise.all([
    rdapLookup(cleaned),
    crtshLookup(cleaned),
  ]);

  const parsed = rdapData
    ? parseRdap(rdapData, cleaned)
    : { domain: cleaned, isValid: false };

  return {
    domain: cleaned,
    isValid: parsed.isValid ?? false,
    registrar: parsed.registrar ?? null,
    registeredOn: parsed.registeredOn ?? null,
    expiresOn: parsed.expiresOn ?? null,
    updatedOn: parsed.updatedOn ?? null,
    nameServers: parsed.nameServers ?? [],
    status: parsed.status ?? [],
    subdomains,
    dns: {
      a: [],
      mx: [],
      txt: [],
    },
    raw: {
      rdap: rdapData,
      crtsh: subdomains,
    },
  };
}
