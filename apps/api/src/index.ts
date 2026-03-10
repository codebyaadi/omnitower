import { Elysia } from "elysia";

import { investigations } from "./modules/investigation";
import { betterAuth } from "./plugins/better-auth";

const app = new Elysia()
  .use(betterAuth)
  .use(investigations)
  .get("/", () => "Hello Elysia")
  .get("/me", ({ user }) => user, {
    auth: true,
  })
  .get("/public", () => "anyone can see this")
  .listen(3001);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

export type App = typeof app;
