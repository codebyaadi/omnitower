import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

import { targetType, investigationStatus } from "../enum/investigation";
import { users } from "./auth";
import { findings } from "./finding";
import { reports } from "./report";

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    targetType: targetType("target_type").notNull(),
    targetValue: text("target_value").notNull(),
    status: investigationStatus("status").notNull().default("pending"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("investigations_user_id_idx").on(table.userId),
    index("investigations_target_type_idx").on(table.targetType),
    index("investigations_status_idx").on(table.status),
  ]
);

export const investigationsRelations = relations(
  investigations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [investigations.userId],
      references: [users.id],
    }),
    findings: many(findings),
    report: one(reports, {
      fields: [investigations.id],
      references: [reports.investigationId],
    }),
  })
);
