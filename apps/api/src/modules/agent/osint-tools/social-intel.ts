/**
 * Social Profiling / Username OSINT Module
 *
 * Discovers accounts across social platforms by probing
 * public profile URLs using username patterns.
 *
 * Similar approach used by Sherlock / Maigret.
 */

export interface SocialProfilingResult {
  /** Username queried */
  username: string;

  /** Platforms where profile exists */
  foundOn: SocialProfile[];

  /** Platforms where profile does not exist */
  notFoundOn: string[];

  /** Platforms where detection failed */
  unknownOn: string[];

  /** Raw probe results */
  raw: {
    probed: SocialProfile[];
  };
}

export interface SocialProfile {
  platform: string;
  url: string;
  status: "found" | "not_found" | "unknown";
}

/**
 * Platform configuration
 */
interface PlatformConfig {
  name: string;
  url: string;
  errorIndicators?: string[];
}

/**
 * Known social platform username patterns
 */
const SOCIAL_PLATFORMS: PlatformConfig[] = [
  { name: "GitHub", url: "https://github.com/{}" },
  { name: "Twitter/X", url: "https://x.com/{}" },
  { name: "Instagram", url: "https://www.instagram.com/{}" },
  { name: "Reddit", url: "https://www.reddit.com/user/{}" },
  { name: "LinkedIn", url: "https://www.linkedin.com/in/{}" },
  { name: "TikTok", url: "https://www.tiktok.com/@{}" },
  { name: "Pinterest", url: "https://www.pinterest.com/{}" },
  { name: "Medium", url: "https://medium.com/@{}" },
  { name: "Dev.to", url: "https://dev.to/{}" },
  { name: "Hashnode", url: "https://hashnode.com/@{}" },
  { name: "HackerNews", url: "https://news.ycombinator.com/user?id={}" },
  { name: "ProductHunt", url: "https://www.producthunt.com/@{}" },
  { name: "Keybase", url: "https://keybase.io/{}" },
  { name: "Steam", url: "https://steamcommunity.com/id/{}" },
  { name: "Twitch", url: "https://www.twitch.tv/{}" },
  { name: "YouTube", url: "https://www.youtube.com/@{}" },
  { name: "Spotify", url: "https://open.spotify.com/user/{}" },
  { name: "Gravatar", url: "https://en.gravatar.com/{}" },
  { name: "Patreon", url: "https://www.patreon.com/{}" },
  { name: "GitLab", url: "https://gitlab.com/{}" },
  { name: "Bitbucket", url: "https://bitbucket.org/{}" },
  { name: "DockerHub", url: "https://hub.docker.com/u/{}" },
  { name: "npm", url: "https://www.npmjs.com/~{}" },
  { name: "PyPI", url: "https://pypi.org/user/{}" },
];

/**
 * Normalize username input.
 */
function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Probe a profile URL.
 *
 * Uses HEAD request first for speed.
 */
async function probeUrl(
  url: string,
  errorIndicators: string[] = []
): Promise<"found" | "not_found" | "unknown"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OmniTower/1.0)",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (res.status === 404) return "not_found";

    if (res.status === 200) {
      // fallback check for platforms that always return 200
      if (errorIndicators.length > 0) {
        const html = await fetch(url).then((r) => r.text());

        if (errorIndicators.some((indicator) => html.includes(indicator))) {
          return "not_found";
        }
      }

      return "found";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Runs probes with concurrency limit.
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const queue = [...tasks];

  const workers = Array.from({ length: limit }).map(async () => {
    while (queue.length) {
      const task = queue.shift();
      if (!task) break;

      const result = await task();
      results.push(result);
    }
  });

  await Promise.all(workers);

  return results;
}

/**
 * Main social profiling function.
 *
 * Steps:
 * 1. Normalize username
 * 2. Generate platform URLs
 * 3. Probe profiles concurrently
 * 4. Aggregate results
 */
export async function runSocialProfiling(
  username: string,
  concurrency = 10
): Promise<SocialProfilingResult> {
  const cleaned = normalizeUsername(username);

  const tasks = SOCIAL_PLATFORMS.map((platform) => async () => {
    const url = platform.url.replace("{}", encodeURIComponent(cleaned));

    const status = await probeUrl(url, platform.errorIndicators);

    return {
      platform: platform.name,
      url,
      status,
    } as SocialProfile;
  });

  const results = await runWithConcurrency(tasks, concurrency);

  const foundOn = results.filter((r) => r.status === "found");

  const notFoundOn = results
    .filter((r) => r.status === "not_found")
    .map((r) => r.platform);

  const unknownOn = results
    .filter((r) => r.status === "unknown")
    .map((r) => r.platform);

  return {
    username: cleaned,
    foundOn,
    notFoundOn,
    unknownOn,
    raw: {
      probed: results,
    },
  };
}
