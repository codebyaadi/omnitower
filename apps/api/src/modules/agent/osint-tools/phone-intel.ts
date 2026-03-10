/**
 * Phone Intelligence / Recon Module
 *
 * Performs OSINT analysis on phone numbers.
 *
 * Current capabilities:
 * - E.164 normalization
 * - country detection
 * - basic number validation
 * - VOIP heuristics
 *
 * Planned providers:
 * - NumVerify
 * - AbstractAPI
 * - Twilio Lookup
 */

export interface PhoneReconResult {
  /** Phone number queried */
  phone: string;

  /** Whether the phone format is valid */
  isValid: boolean;

  /** Country dialing code */
  countryCode: string | null;

  /** Country name */
  country: string | null;

  /** Carrier (future API providers) */
  carrier: string | null;

  /** Line type */
  lineType: "mobile" | "landline" | "voip" | null;

  /** Formatted representations */
  formatted: {
    international: string | null;
    local: string | null;
  };

  /** Raw diagnostic data */
  raw: Record<string, unknown>;
}

/**
 * Partial global country code map
 */
const COUNTRY_CODES: Record<string, string> = {
  "1": "United States / Canada",
  "7": "Russia",
  "33": "France",
  "44": "United Kingdom",
  "49": "Germany",
  "55": "Brazil",
  "61": "Australia",
  "81": "Japan",
  "86": "China",
  "91": "India",
  "65": "Singapore",
  "971": "United Arab Emirates",
};

/**
 * Known VOIP provider prefixes (very rough heuristic)
 */
const VOIP_PREFIXES = [
  "+883", // international networks
  "+882",
];

/**
 * Normalize phone number input.
 *
 * Removes spaces, punctuation, and converts
 * numbers to a clean E.164-like string.
 */
function normalizePhone(phone: string): string {
  return phone.trim().replace(/[^\d+]/g, "");
}

/**
 * Attempts to parse a phone number using
 * simplified E.164 logic.
 */
function parsePhone(phone: string): {
  valid: boolean;
  normalized: string;
  countryCode: string | null;
  nationalNumber: string | null;
} {
  const cleaned = normalizePhone(phone);

  if (!cleaned.startsWith("+")) {
    return {
      valid: false,
      normalized: cleaned,
      countryCode: null,
      nationalNumber: null,
    };
  }

  const digits = cleaned.slice(1);

  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      normalized: cleaned,
      countryCode: null,
      nationalNumber: null,
    };
  }

  for (let i = 1; i <= 3; i++) {
    const code = digits.slice(0, i);

    if (COUNTRY_CODES[code]) {
      return {
        valid: true,
        normalized: `+${digits}`,
        countryCode: `+${code}`,
        nationalNumber: digits.slice(i),
      };
    }
  }

  return {
    valid: false,
    normalized: cleaned,
    countryCode: null,
    nationalNumber: null,
  };
}

/**
 * Detects VOIP numbers using simple heuristics.
 */
function detectVoip(number: string): boolean {
  return VOIP_PREFIXES.some((prefix) => number.startsWith(prefix));
}

/**
 * Formats local representation.
 *
 * This is only a best-effort formatter.
 */
function formatLocal(nationalNumber: string | null): string | null {
  if (!nationalNumber) return null;

  if (nationalNumber.length === 10) {
    return `${nationalNumber.slice(0, 3)}-${nationalNumber.slice(
      3,
      6
    )}-${nationalNumber.slice(6)}`;
  }

  return nationalNumber;
}

/**
 * Runs phone number intelligence.
 *
 * Steps:
 * 1. Normalize input
 * 2. Parse E.164 structure
 * 3. Detect country
 * 4. Apply VOIP heuristics
 * 5. Format output
 */
export async function runPhoneRecon(phone: string): Promise<PhoneReconResult> {
  const parsed = parsePhone(phone);

  const countryCodeNum = parsed.countryCode?.replace("+", "") ?? null;

  const country = countryCodeNum
    ? (COUNTRY_CODES[countryCodeNum] ?? null)
    : null;

  const voip = parsed.normalized ? detectVoip(parsed.normalized) : false;

  return {
    phone,
    isValid: parsed.valid,
    countryCode: parsed.countryCode,
    country,
    carrier: null,
    lineType: voip ? "voip" : null,
    formatted: {
      international: parsed.valid ? parsed.normalized : null,
      local: formatLocal(parsed.nationalNumber),
    },
    raw: {
      parsed,
      voipDetected: voip,
    },
  };
}
