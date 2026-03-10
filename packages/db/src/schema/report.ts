import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

import { reportStatus } from "../enum/report";
import { investigations } from "./investigation";

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .unique()
      .references(() => investigations.id, { onDelete: "cascade" }),
    status: reportStatus("status").notNull().default("generating"),
    summary: text("summary"),
    riskScore: text("risk_score"), // "low" | "medium" | "high" | "critical"
    analysis: jsonb("analysis"), // { sections, entities, timeline }
    modelUsed: text("model_used"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index("reports_investigation_id_idx").on(t.investigationId),
    index("reports_status_idx").on(t.status),
  ]
);

export const reportsRelations = relations(reports, ({ one }) => ({
  investigation: one(investigations, {
    fields: [reports.investigationId],
    references: [investigations.id],
  }),
}));
