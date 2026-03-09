import { auth } from "@omnitower/auth/server";
import { Elysia } from "elysia";

const betterAuth = new Elysia({ name: "better-auth" }).macro({
  auth: {
    async resolve({ status, request: { headers } }) {
      const session = await auth.api.getSession({
        headers,
      });
      if (!session) return status(401);
      return {
        user: session.user,
        session: session.session,
      };
    },
  },
});

const app = new Elysia()
  .use(betterAuth)
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
