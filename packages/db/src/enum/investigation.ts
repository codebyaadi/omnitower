import { pgEnum } from "drizzle-orm/pg-core";

export const investigationStatus = pgEnum("investigation_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const targetType = pgEnum("target_type", [
  "email",
  "phone",
  "domain",
  "ip",
  "username",
  "person",
]);
