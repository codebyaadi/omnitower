import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  jsonb,
} from "drizzle-orm/pg-core";

import { findingModule, findingStatus } from "../enum/finding";
import { investigations } from "./investigation";

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    module: findingModule("module").notNull(),
    status: findingStatus("status").notNull().default("pending"),
    source: text("source"),
    rawData: jsonb("raw_data"),
    parsedData: jsonb("parsed_data"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("findings_investigation_id_idx").on(table.investigationId),
    index("findings_module_idx").on(table.module),
    index("findings_status_idx").on(table.status),
  ]
);

export const findingsRelations = relations(findings, ({ one }) => ({
  investigation: one(investigations, {
    fields: [findings.investigationId],
    references: [investigations.id],
  }),
}));
