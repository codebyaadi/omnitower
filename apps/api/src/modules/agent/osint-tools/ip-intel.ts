/**
 * IP Intelligence Module
 *
 * Aggregates IP intelligence data from multiple public APIs.
 *
 * Current providers:
 * - ipinfo.io
 * - ip-api.com
 *
 * Planned providers:
 * - AbuseIPDB
 * - Shodan
 *
 * No API keys required for current providers.
 */

export interface IpIntelResult {
  /** IP address that was queried */
  ip: string;

  /** Whether the IP string format is valid */
  isValid: boolean;

  /** Whether the IP is private / reserved */
  isPrivate: boolean;

  /** Reverse DNS hostname */
  hostname: string | null;

  /** City */
  city: string | null;

  /** Region / state */
  region: string | null;

  /** Country name */
  country: string | null;

  /** Country code (ISO-2) */
  countryCode: string | null;

  /** Latitude */
  latitude: number | null;

  /** Longitude */
  longitude: number | null;

  /** Organization name */
  org: string | null;

  /** Autonomous system number (ASN) */
  asn: string | null;

  /** ISP name */
  isp: string | null;

  /** Whether IP is VPN (future provider) */
  isVpn: boolean | null;

  /** Whether IP is Tor (future provider) */
  isTor: boolean | null;

  /** Whether IP is detected proxy */
  isProxy: boolean | null;

  /** Abuse score (future provider) */
  abuseScore: number | null;

  /** List of open ports (future provider) */
  openPorts: number[];

  /** Raw provider responses for debugging */
  raw: {
    ipinfo?: IpInfoResponse | null;
    ipapi?: IpApiResponse | null;
  };
}

/**
 * ipinfo.io response shape (partial)
 */
interface IpInfoResponse {
  ip?: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  org?: string;
  loc?: string;
}

/**
 * ip-api.com response shape (partial)
 */
interface IpApiResponse {
  status?: string;
  message?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  isp?: string;
  org?: string;
  as?: string;
  proxy?: boolean;
  hosting?: boolean;
}

/**
 * Private IP ranges (IPv4 + IPv6)
 */
const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^::1$/,
  /^fc00:/,
];

/**
 * Checks if an IP address belongs to a private range.
 */
function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((range) => range.test(ip));
}

/**
 * Validates IPv4 or IPv6 format.
 */
function isValidIp(ip: string): boolean {
  const ipv4 =
    /^(25[0-5]|2[0-4]\d|1\d\d|\d\d|\d)(\.(25[0-5]|2[0-4]\d|1\d\d|\d\d|\d)){3}$/;

  const ipv6 = /^([0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}$/;

  return ipv4.test(ip) || ipv6.test(ip);
}

/**
 * Fetch IP intelligence from ipinfo.io
 */
async function ipInfoLookup(ip: string): Promise<IpInfoResponse | null> {
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`);

    if (!res.ok) return null;

    return (await res.json()) as IpInfoResponse;
  } catch {
    return null;
  }
}

/**
 * Fetch IP intelligence from ip-api.com
 */
async function ipApiLookup(ip: string): Promise<IpApiResponse | null> {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,region,city,lat,lon,isp,org,as,proxy,hosting`
    );

    if (!res.ok) return null;

    return (await res.json()) as IpApiResponse;
  } catch {
    return null;
  }
}

/**
 * Parses ipinfo location string ("lat,lon")
 */
function parseLocation(loc?: string): [number | null, number | null] {
  if (!loc) return [null, null];

  const parts = loc.split(",");

  if (parts.length !== 2) return [null, null];

  const lat = Number(parts[0]);
  const lon = Number(parts[1]);

  if (Number.isNaN(lat) || Number.isNaN(lon)) return [null, null];

  return [lat, lon];
}

/**
 * Runs IP intelligence lookup using multiple providers.
 *
 * Steps:
 * 1. Validate IP format
 * 2. Detect private ranges
 * 3. Query external providers
 * 4. Merge and normalize results
 */
export async function runIpIntel(ip: string): Promise<IpIntelResult> {
  const cleaned = ip.trim();

  if (!isValidIp(cleaned)) {
    return {
      ip: cleaned,
      isValid: false,
      isPrivate: false,
      hostname: null,
      city: null,
      region: null,
      country: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      org: null,
      asn: null,
      isp: null,
      isVpn: null,
      isTor: null,
      isProxy: null,
      abuseScore: null,
      openPorts: [],
      raw: {},
    };
  }

  if (isPrivateIp(cleaned)) {
    return {
      ip: cleaned,
      isValid: true,
      isPrivate: true,
      hostname: null,
      city: null,
      region: null,
      country: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      org: null,
      asn: null,
      isp: null,
      isVpn: null,
      isTor: null,
      isProxy: null,
      abuseScore: null,
      openPorts: [],
      raw: {},
    };
  }

  const [ipInfoData, ipApiData] = await Promise.all([
    ipInfoLookup(cleaned),
    ipApiLookup(cleaned),
  ]);

  const [lat, lon] = parseLocation(ipInfoData?.loc);

  const asn =
    ipInfoData?.org?.split(" ")[0] ?? ipApiData?.as?.split(" ")[0] ?? null;

  return {
    ip: cleaned,
    isValid: true,
    isPrivate: false,
    hostname: ipInfoData?.hostname ?? null,
    city: ipInfoData?.city ?? ipApiData?.city ?? null,
    region: ipInfoData?.region ?? ipApiData?.region ?? null,
    country: ipInfoData?.country ?? ipApiData?.country ?? null,
    countryCode: ipApiData?.countryCode ?? null,
    latitude: lat ?? ipApiData?.lat ?? null,
    longitude: lon ?? ipApiData?.lon ?? null,
    org: ipInfoData?.org ?? ipApiData?.org ?? null,
    asn,
    isp: ipApiData?.isp ?? null,
    isVpn: null,
    isTor: null,
    isProxy: ipApiData?.proxy ?? null,
    abuseScore: null,
    openPorts: [],
    raw: {
      ipinfo: ipInfoData,
      ipapi: ipApiData,
    },
  };
}
