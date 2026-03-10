/**
 * Email Intelligence / Recon Module
 *
 * Collects intelligence signals about an email address.
 *
 * Current sources:
 * - EmailRep API
 * - Disposable domain detection
 * - Free provider detection
 * - Gravatar OSINT
 * - Domain MX record check
 *
 * Planned sources:
 * - HaveIBeenPwned
 * - Hunter.io
 */

export interface EmailReconResult {
  /** Email address queried */
  email: string;

  /** Whether email format is valid */
  isValid: boolean;

  /** Whether domain is disposable */
  isDisposable: boolean;

  /** Whether email uses a free provider */
  isFreeProvider: boolean;

  /** Reputation score from EmailRep */
  reputation: string | null;

  /** Whether email appears suspicious */
  suspicious: boolean;

  /** Known social profiles */
  profiles: string[];

  /** Breach count (future HIBP integration) */
  breachCount: number | null;

  /** First seen timestamp */
  firstSeen: string | null;

  /** Last seen timestamp */
  lastSeen: string | null;

  /** Whether a Gravatar profile exists */
  hasGravatar: boolean;

  /** Whether domain has MX records */
  hasMx: boolean;

  /** Raw provider responses */
  raw: {
    emailrep?: EmailRepResponse | null;
  };
}

/**
 * EmailRep API response shape (partial)
 */
interface EmailRepResponse {
  reputation?: string;
  suspicious?: boolean;
  status?: string;
  attributes?: {
    disposable?: boolean;
    free_provider?: boolean;
    profiles?: string[];
    first_seen?: string;
    last_seen?: string;
  };
}

/**
 * Known disposable email domains
 */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "throwaway.email",
  "yopmail.com",
  "sharklasers.com",
  "10minutemail.com",
  "trashmail.com",
  "maildrop.cc",
]);

/**
 * Popular free email providers
 */
const FREE_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "protonmail.com",
  "aol.com",
  "live.com",
]);

/**
 * Basic email format validation
 */
function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return regex.test(email);
}

/**
 * Extracts domain from email
 */
function extractDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/**
 * Queries EmailRep reputation service
 */
async function checkEmailRep(email: string): Promise<EmailRepResponse | null> {
  try {
    const res = await fetch(
      `https://emailrep.io/${encodeURIComponent(email)}`,
      {
        headers: { "User-Agent": "OmniTower/1.0" },
      }
    );

    if (!res.ok) return null;

    return (await res.json()) as EmailRepResponse;
  } catch {
    return null;
  }
}

/**
 * Checks if a Gravatar profile exists for the email.
 *
 * Uses MD5 hash lookup.
 */
async function checkGravatar(email: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(email.trim().toLowerCase());

    const hashBuffer = await crypto.subtle.digest("MD5", data);

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const res = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404`);

    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Checks if domain has MX records.
 * Uses Google DNS-over-HTTPS API.
 */
async function checkMx(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${domain}&type=MX`
    );

    if (!res.ok) return false;

    const data = await res.json();

    return Array.isArray(data.Answer) && data.Answer.length > 0;
  } catch {
    return false;
  }
}

/**
 * Runs email reconnaissance.
 *
 * Steps:
 * 1. Validate email format
 * 2. Extract domain
 * 3. Query EmailRep
 * 4. Check disposable provider
 * 5. Detect Gravatar
 * 6. Verify MX records
 */
export async function runEmailRecon(email: string): Promise<EmailReconResult> {
  const cleaned = email.trim().toLowerCase();

  if (!isValidEmail(cleaned)) {
    return {
      email: cleaned,
      isValid: false,
      isDisposable: false,
      isFreeProvider: false,
      reputation: null,
      suspicious: false,
      profiles: [],
      breachCount: null,
      firstSeen: null,
      lastSeen: null,
      hasGravatar: false,
      hasMx: false,
      raw: {},
    };
  }

  const domain = extractDomain(cleaned);

  const [emailRepData, hasGravatar, hasMx] = await Promise.all([
    checkEmailRep(cleaned),
    checkGravatar(cleaned),
    checkMx(domain),
  ]);

  const attributes = emailRepData?.attributes;

  return {
    email: cleaned,
    isValid: emailRepData ? emailRepData.status !== "invalid" : true,

    isDisposable: DISPOSABLE_DOMAINS.has(domain) || !!attributes?.disposable,

    isFreeProvider: FREE_PROVIDERS.has(domain) || !!attributes?.free_provider,

    reputation: emailRepData?.reputation ?? null,

    suspicious: !!emailRepData?.suspicious,

    profiles: attributes?.profiles ?? [],

    breachCount: null,

    firstSeen: attributes?.first_seen ?? null,

    lastSeen: attributes?.last_seen ?? null,

    hasGravatar,

    hasMx,

    raw: {
      emailrep: emailRepData,
    },
  };
}
