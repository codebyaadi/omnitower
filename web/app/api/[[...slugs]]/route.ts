import { Elysia } from "elysia";

import { betterAuth } from "@/lib/api/plugins/better-auth";
import { userRoutes } from "@/lib/api/routes/user";

export const app = new Elysia({ prefix: "/api" })
  .use(betterAuth)
  .use(userRoutes)
  .get("/", "Omnitower");

export const GET = app.fetch;
export const POST = app.fetch;
export const PUT = app.fetch;
export const PATCH = app.fetch;
export const DELETE = app.fetch;
