import { pgEnum } from "drizzle-orm/pg-core";

export const reportStatus = pgEnum("report_status", [
  "generating",
  "completed",
  "failed",
]);
