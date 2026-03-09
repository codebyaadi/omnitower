import { Elysia } from "elysia";

import { betterAuth } from "@/lib/api/plugins/better-auth";

export const userRoutes = new Elysia({ prefix: "/user" })
  .use(betterAuth) // ← types flow down from here
  .get("/me", ({ user }) => user, {
    auth: true,
  })
  .get("/public", () => "anyone can see this");
