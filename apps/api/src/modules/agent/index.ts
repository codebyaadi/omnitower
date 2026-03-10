/**
 * Agentic OSINT investigation loop.
 *
 * Orchestrates LLM tool-calling to run investigative tools,
 * persist findings, and generate a final intelligence report.
 */

import { db } from "@omnitower/db";
import { findings } from "@omnitower/db/schema/finding";
import { investigations } from "@omnitower/db/schema/investigation";
import { reports } from "@omnitower/db/schema/report";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

import { createAgentLogger } from "./logger";
import { AGENT_SYSTEM_PROMPT, REPORT_PROMPT } from "./prompts";
import { registry, type ToolExecutionResult } from "./registry";

// Constants
const MAX_ITERATIONS = 10;
const MODEL = "gpt-4o";
const openai = new OpenAI();
const JSON_DEPTH_LIMIT = 3;

/**
 * Valid DB enum values for the `module` column.
 * Must stay in sync with your DB schema enum definition.
 */
const VALID_MODULES = new Set([
  "email_recon",
  "phone_recon",
  "domain_intel",
  "ip_intel",
  "social_profiling",
]);

/**
 * Safely serializes objects to JSON for LLM input, with depth control.
 */
function safeStringify(obj: unknown, depth = JSON_DEPTH_LIMIT): string {
  if (depth === 0) return "...";
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj))
    return `[${obj.map((v) => safeStringify(v, depth - 1)).join(", ")}]`;

  return `{${Object.entries(obj)
    .map(([k, v]) => `"${k}":${safeStringify(v, depth - 1)}`)
    .join(", ")}}`;
}

/**
 * Normalized representation of a tool call from OpenAI.
 */
interface NormalizedToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Type-guard + normalization for both function and custom tool calls.
 */
function normalizeToolCall(call: any): NormalizedToolCall | null {
  if (!call || typeof call !== "object") return null;

  if (
    call.type === "function" &&
    call.function?.name &&
    call.function?.arguments
  ) {
    // Standard OpenAI format: { type: "function", id, function: { name, arguments } }
    return {
      id: call.id,
      name: call.function.name,
      args: call.function.arguments,
    };
  }

  if (call.type === "function" && "name" in call && "arguments" in call) {
    return { id: call.id, name: call.name, args: call.arguments };
  }

  if (call.type === "tool" && "tool" in call && "arguments" in call) {
    return { id: call.id, name: call.tool, args: call.arguments };
  }

  return null;
}

/**
 * Resolved result of a single tool call — bundles the call ID with its result.
 */
interface ResolvedToolCall {
  callId: string;
  name: string;
  result: ToolExecutionResult;
  skipped: boolean;
}

/**
 * Runs the AI investigative agent loop.
 * @param investigationId ID of the investigation in DB
 * @param targetValue Value of the target (email, domain, IP, etc.)
 * @param targetType Type of the target ("email" | "domain" | "ip" | "username" | "phone" | "person")
 */
export async function runAgentLoop(
  investigationId: string,
  targetValue: string,
  targetType: string
): Promise<void> {
  const log = createAgentLogger(investigationId);
  const loopStart = Date.now();

  log.info("Agent loop starting", {
    investigationId,
    targetType,
    targetValue,
    model: MODEL,
    maxIterations: MAX_ITERATIONS,
  });

  await db
    .update(investigations)
    .set({ status: "running" })
    .where(eq(investigations.id, investigationId));

  log.debug("Investigation status set to running");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Investigate this target:\n\nType: ${targetType}\nValue: ${targetValue}`,
    },
  ];

  const allResults: ToolExecutionResult[] = [];
  const calledTools = new Set<string>();
  const pivotChain: string[] = [];
  let iterations = 0;
  let finalSummary = "";

  try {
    while (iterations < MAX_ITERATIONS) {
      const iterStart = Date.now();
      log.info(`Iteration ${iterations + 1} — calling LLM`, {
        iteration: iterations + 1,
        messageCount: messages.length,
        toolsAvailable: registry.list().length,
      });

      const response = await openai.chat.completions.create({
        model: MODEL,
        tools: registry.getOpenAITools(),
        tool_choice: "auto",
        messages,
      });

      const message = response.choices[0]?.message;

      if (!message) {
        log.warn("LLM returned no message — stopping loop", {
          iteration: iterations + 1,
        });
        break;
      }

      log.debug("LLM response received", {
        iteration: iterations + 1,
        finishReason: response.choices[0].finish_reason,
        toolCallCount: message.tool_calls?.length ?? 0,
        hasContent: Boolean(message.content),
        durationMs: Date.now() - iterStart,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      });

      messages.push(message);

      if (message.content) {
        finalSummary = message.content;
        log.info("Agent produced inline summary", {
          preview: message.content.slice(0, 120),
        });
      }

      // No tool calls → agent signalled it is done
      if (!message.tool_calls || message.tool_calls.length === 0) {
        log.info("No tool calls returned — agent finished", {
          iteration: iterations + 1,
        });
        break;
      }

      log.info(`Dispatching ${message.tool_calls.length} tool call(s)`, {
        iteration: iterations + 1,
        tools: message.tool_calls.map(
          (c) => normalizeToolCall(c)?.name ?? "unknown"
        ),
      });

      // ── Execute all tool calls in parallel ────────────────────
      const resolvedCalls: ResolvedToolCall[] = await Promise.all(
        message.tool_calls.map(async (rawCall): Promise<ResolvedToolCall> => {
          const normalized = normalizeToolCall(rawCall);

          // ── Unrecognized call format ───────────────────────────
          if (!normalized) {
            log.tool("unknown", "error", {
              callId: rawCall.id,
              reason: "Unsupported tool call format",
              raw: JSON.stringify(rawCall).slice(0, 200),
            });
            return {
              callId: rawCall.id,
              name: "unknown",
              skipped: true,
              result: {
                name: "unknown",
                source: "agent",
                data: {},
                error: "Unsupported tool call format",
              },
            };
          }

          const { id: callId, name, args } = normalized;

          // ── Deduplication ──────────────────────────────────────
          const dedupeKey = `${name}:${args}`;
          if (calledTools.has(dedupeKey)) {
            log.tool(name, "skip", { callId, reason: "duplicate call", args });
            return {
              callId,
              name,
              skipped: true,
              result: {
                name,
                source: "cache",
                data: {},
                error: "Duplicate call skipped",
              },
            };
          }
          calledTools.add(dedupeKey);

          // ── Parse arguments ────────────────────────────────────
          let input: unknown;
          try {
            input = JSON.parse(args);
          } catch {
            log.tool(name, "error", {
              callId,
              reason: "Invalid JSON arguments",
              args,
            });
            return {
              callId,
              name,
              skipped: true,
              result: {
                name,
                source: "agent",
                data: {},
                error: "Invalid JSON arguments",
              },
            };
          }

          // ── Execute via registry ───────────────────────────────
          log.tool(name, "call", { callId, input });

          const toolStart = Date.now();
          const result = await registry.execute(name, input);
          const toolDuration = Date.now() - toolStart;

          if (result.error) {
            log.tool(name, "error", {
              callId,
              error: result.error,
              durationMs: toolDuration,
            });
          } else {
            log.tool(name, "success", {
              callId,
              source: result.source,
              durationMs: toolDuration,
              dataKeys:
                result.data && typeof result.data === "object"
                  ? Object.keys(result.data as object)
                  : undefined,
            });
          }

          const pivot = `${name}:${safeStringify(input)} → ${safeStringify(result.data)}`;
          pivotChain.push(pivot);
          log.debug("Pivot recorded", { pivot: pivot.slice(0, 200) });

          return { callId, name, result, skipped: false };
        })
      );

      // ── Persist findings + build tool reply messages ───────────
      const toolMessages: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

      await Promise.all(
        resolvedCalls.map(async ({ callId, name, result, skipped }) => {
          // Only persist to DB if this is a known registry tool
          // (avoids enum violations for "unknown" / "cache" / etc.)
          if (!skipped && VALID_MODULES.has(name)) {
            try {
              await db.insert(findings).values({
                investigationId,
                module: name as never, // narrowed by VALID_MODULES guard
                status: result.error ? "failed" : "success",
                source: result.source,
                rawData: (result.data ?? {}) as Record<string, unknown>,
                parsedData: (result.data ?? {}) as Record<string, unknown>,
                errorMessage: result.error ?? null,
              });
              log.debug("Finding persisted to DB", {
                module: name,
                status: result.error ? "failed" : "success",
              });
            } catch (dbErr) {
              log.error("Failed to persist finding to DB", dbErr, {
                module: name,
                callId,
              });
            }
          } else if (skipped) {
            log.tool(name, "db_skip", {
              callId,
              reason: "skipped call — not persisted",
            });
          } else {
            log.tool(name, "db_skip", {
              callId,
              reason: "not in VALID_MODULES — not persisted",
            });
          }

          // Always collect results for the final report
          if (!skipped) allResults.push(result);

          // Always reply to the LLM for every tool call it made
          toolMessages.push({
            role: "tool",
            tool_call_id: callId,
            content: result.error
              ? `Error: ${result.error}`
              : safeStringify(result.data),
          });
        })
      );

      messages.push(...toolMessages);
      iterations++;

      log.info(`Iteration ${iterations} complete`, {
        iteration: iterations,
        durationMs: Date.now() - iterStart,
        totalResults: allResults.length,
        pivotChainLength: pivotChain.length,
      });
    }

    // ── Final status ─────────────────────────────────────────────
    const succeeded = allResults.filter((r) => !r.error).length;
    const failed = allResults.filter((r) => r.error).length;
    const status = succeeded > 0 ? "completed" : "failed";

    log.info("Agent loop finished", {
      status,
      totalIterations: iterations,
      totalTools: allResults.length,
      succeeded,
      failed,
      totalDurationMs: Date.now() - loopStart,
    });

    await db
      .update(investigations)
      .set({ status })
      .where(eq(investigations.id, investigationId));

    if (status === "completed") {
      await generateReport(
        investigationId,
        targetValue,
        targetType,
        allResults,
        finalSummary,
        pivotChain,
        log
      );
    } else {
      log.warn("Investigation marked failed — skipping report generation", {
        succeeded,
        failed,
      });
    }
  } catch (err) {
    log.error("Unhandled exception in agent loop", err, {
      iterations,
      totalDurationMs: Date.now() - loopStart,
    });

    await db
      .update(investigations)
      .set({ status: "failed" })
      .where(eq(investigations.id, investigationId));
  }
}

/**
 * Generates a structured intelligence report using the agent's findings.
 */
async function generateReport(
  investigationId: string,
  targetValue: string,
  targetType: string,
  results: ToolExecutionResult[],
  agentSummary: string,
  pivotChain: string[],
  log: ReturnType<typeof createAgentLogger>
): Promise<void> {
  log.info("Report generation starting", {
    investigationId,
    successfulResults: results.filter((r) => !r.error).length,
    pivotChainLength: pivotChain.length,
  });

  const [report] = await db
    .insert(reports)
    .values({
      investigationId,
      status: "generating",
      modelUsed: MODEL,
    })
    .returning();

  log.debug("Report row created", { reportId: report.id });

  const reportStart = Date.now();

  try {
    const successfulResults = results
      .filter((r) => !r.error)
      .map((r) => ({ module: r.name, source: r.source, data: r.data }));

    log.debug("Calling LLM for report synthesis", {
      modules: successfulResults.map((r) => r.module),
    });

    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: REPORT_PROMPT(
            targetValue,
            targetType,
            successfulResults,
            agentSummary
          ),
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    log.debug("Report LLM response parsed", {
      riskScore: parsed.risk_score,
      keyFindingsCount: parsed.analysis?.key_findings?.length ?? 0,
      entitiesCount: parsed.analysis?.entities?.length ?? 0,
      durationMs: Date.now() - reportStart,
    });

    await db
      .update(reports)
      .set({
        status: "completed",
        summary: parsed.summary,
        riskScore: parsed.risk_score,
        analysis: { ...parsed.analysis, pivot_chain: pivotChain },
      })
      .where(eq(reports.id, report.id));

    log.info("Report generation complete", {
      reportId: report.id,
      riskScore: parsed.risk_score,
      summary: parsed.summary?.slice(0, 120),
      durationMs: Date.now() - reportStart,
    });
  } catch (err) {
    log.error("Report generation failed", err, {
      reportId: report.id,
      durationMs: Date.now() - reportStart,
    });

    await db
      .update(reports)
      .set({ status: "failed" })
      .where(eq(reports.id, report.id));
  }
}
