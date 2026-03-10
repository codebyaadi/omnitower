import { db } from "@omnitower/db";
import { findings } from "@omnitower/db/schema/finding";
import { investigations } from "@omnitower/db/schema/investigation";
import { reports } from "@omnitower/db/schema/report";
import { eq } from "drizzle-orm";

import { runAgentLoop } from "../agent";
import type { InvestigationModel } from "./model";

export abstract class InvestigationService {
  static async create(userId: string, body: InvestigationModel["createBody"]) {
    const [investigation] = await db
      .insert(investigations)
      .values({
        userId: userId,
        title: body.title,
        targetType: body.targetType,
        targetValue: body.targetValue,
        status: "pending",
      })
      .returning();

    // Fire and forget — agent runs in background
    runAgentLoop(investigation.id, body.targetValue, body.targetType).catch(
      console.error
    );

    return investigation;
  }

  static async list(userId: string) {
    return db
      .select()
      .from(investigations)
      .where(eq(investigations.userId, userId))
      .orderBy(investigations.createdAt);
  }

  static async getById(id: string, userId: string) {
    const [investigation] = await db
      .select()
      .from(investigations)
      .where(eq(investigations.id, id))
      .limit(1);

    if (!investigation || investigation.userId !== userId) return null;

    const [investigationFindings, [report]] = await Promise.all([
      db.select().from(findings).where(eq(findings.investigationId, id)),
      db.select().from(reports).where(eq(reports.investigationId, id)).limit(1),
    ]);

    return {
      ...investigation,
      findings: investigationFindings,
      report: report ?? null,
    };
  }

  static async delete(id: string, userId: string) {
    const [investigation] = await db
      .select()
      .from(investigations)
      .where(eq(investigations.id, id))
      .limit(1);

    if (!investigation || investigation.userId !== userId) return null;

    await db.delete(investigations).where(eq(investigations.id, id));
    return { deleted: true };
  }

  static async getReport(id: string, userId: string) {
    const investigation = await InvestigationService.getById(id, userId);
    if (!investigation) return null;
    return investigation.report;
  }
}
