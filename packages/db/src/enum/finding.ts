import { pgEnum } from "drizzle-orm/pg-core";

export const findingModule = pgEnum("finding_module", [
  "email_recon",
  "phone_recon",
  "domain_intel",
  "ip_intel",
  "social_profiling",
  "identity_lookup",
]);

export const findingStatus = pgEnum("finding_status", [
  "pending",
  "success",
  "failed",
  "skipped",
]);
