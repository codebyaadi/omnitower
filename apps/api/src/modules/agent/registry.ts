import { t, type TSchema } from "elysia";
import Value from "typebox/value";

import { runDomainIntel } from "./osint-tools/domain-intel";
import { runEmailRecon } from "./osint-tools/email-intel";
import { runIpIntel } from "./osint-tools/ip-intel";
import { runPhoneRecon } from "./osint-tools/phone-intel";
import { runSocialProfiling } from "./osint-tools/social-intel";

type Static<T extends TSchema> = T extends { static: infer S } ? S : unknown;

/**
 * Tool definition used by the OSINT agent registry.
 */
export interface OsintTool<TInput extends TSchema = TSchema> {
  name: string;
  description: string;
  inputSchema: TInput;
  source: string;

  /** Optional categorization */
  tags?: string[];

  /** Execution timeout in milliseconds */
  timeoutMs?: number;

  execute: (input: Static<TInput>) => Promise<unknown>;
}

/**
 * Tool definition format required by OpenAI function calling.
 */
export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Standardized tool execution response.
 */
export interface ToolExecutionResult {
  name: string;
  source: string;
  data: unknown;
  error?: string;
  durationMs?: number;
}

/**
 * Wrap promise with timeout protection
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Tool execution timed out")), ms)
  );

  return Promise.race([promise, timeout]);
}

class ToolRegistry {
  private tools = new Map<string, OsintTool>();

  /**
   * Register a new tool.
   *
   * Example:
   *
   * ```ts
   * registry.register({
   *   name: "email_recon",
   *   description: "...",
   *   inputSchema: t.Object({ email: t.String() }),
   *   execute: async () => {}
   * })
   * ```
   */
  register<TInput extends TSchema>(tool: OsintTool<TInput>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool as OsintTool);
    return this;
  }

  /**
   * Returns OpenAI-compatible tool definitions.
   *
   * Used when initializing the LLM.
   */
  getOpenAITools(): OpenAIToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Execute a tool safely.
   *
   * Handles:
   * - Input validation
   * - Error capture
   * - Timeout protection
   * - Execution metrics
   */
  async execute(name: string, rawInput: unknown): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        name,
        source: "unknown",
        data: null,
        error: `Unknown tool: ${name}`,
      };
    }

    // Validate input schema
    if (!Value.Check(tool.inputSchema, rawInput)) {
      const errors = [...Value.Errors(tool.inputSchema, rawInput)]
        .map((e) => `${e.instancePath || "input"}: ${e.message}`)
        .join(", ");

      return {
        name,
        source: tool.source,
        data: null,
        error: `Invalid input: ${errors}`,
      };
    }

    const start = Date.now();

    try {
      const promise = tool.execute(rawInput as never);

      const data = tool.timeoutMs
        ? await withTimeout(promise, tool.timeoutMs)
        : await promise;

      return {
        name,
        source: tool.source,
        data,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        name,
        source: tool.source,
        data: null,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns tool names for agent planning.
   */
  list(): string[] {
    return [...this.tools.keys()];
  }

  /**
   * Retrieve a tool definition.
   */
  get(name: string): OsintTool | undefined {
    return this.tools.get(name);
  }
}

// Singleton registry instance
export const registry = new ToolRegistry();

// Tool registrations
registry.register({
  name: "email_recon",
  description:
    "Investigate an email address. Returns reputation score, disposable provider detection, linked social accounts, and breach indicators. Use when an email address is known or discovered during investigation.",
  source: "emailrep.io",
  tags: ["identity", "email", "osint"],
  timeoutMs: 8000,
  inputSchema: t.Object({
    email: t.String({ format: "email" }),
  }),
  execute: ({ email }) => runEmailRecon(email),
});

registry.register({
  name: "phone_recon",
  description:
    "Investigate a phone number. Returns carrier, country, line type, and validity. Useful for identifying telecom provider and geographic origin.",
  source: "internal",
  tags: ["identity", "phone"],
  timeoutMs: 5000,
  inputSchema: t.Object({
    phone: t.String({ minLength: 7 }),
  }),
  execute: ({ phone }) => runPhoneRecon(phone),
});

registry.register({
  name: "domain_intel",
  description:
    "Investigate a domain name. Returns WHOIS/RDAP data, certificate transparency subdomains, DNS records, registrar information, and domain registration metadata.",
  source: "rdap.org, crt.sh",
  tags: ["infrastructure", "domain"],
  timeoutMs: 10000,
  inputSchema: t.Object({
    domain: t.String({
      minLength: 3,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9\\-.]+\\.[a-zA-Z]{2,}$",
    }),
  }),
  execute: ({ domain }) => runDomainIntel(domain),
});

registry.register({
  name: "ip_intel",
  description:
    "Investigate an IP address. Returns geolocation, ASN, ISP, organization, and proxy/hosting detection.",
  source: "ipinfo.io, ip-api.com",
  tags: ["infrastructure", "ip"],
  timeoutMs: 6000,
  inputSchema: t.Object({
    ip: t.String({
      pattern: "^(\\d{1,3}\\.){3}\\d{1,3}$|^[0-9a-fA-F:]+$",
    }),
  }),
  execute: ({ ip }) => runIpIntel(ip),
});

registry.register({
  name: "social_profiling",
  description:
    "Search for a username across major social platforms including GitHub, Twitter/X, Instagram, Reddit, LinkedIn, TikTok, and YouTube. Returns discovered profile URLs.",
  source: "http-probe",
  tags: ["identity", "social"],
  timeoutMs: 10000,
  inputSchema: t.Object({
    username: t.String({ minLength: 2, maxLength: 50 }),
  }),
  execute: ({ username }) => runSocialProfiling(username),
});
