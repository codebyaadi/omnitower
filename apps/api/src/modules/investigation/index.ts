import { Elysia } from "elysia";

import { betterAuth } from "../../plugins/better-auth";
import { InvestigationModel } from "./model";
import { InvestigationService } from "./service";

export const investigations = new Elysia({ prefix: "/investigations" })
  .use(betterAuth)
  .get(
    "/",
    async ({ session }) => {
      const data = await InvestigationService.list(session.userId);
      return { data };
    },
    { auth: true }
  )
  .post(
    "/",
    async ({ session, body }) => {
      const data = await InvestigationService.create(session.userId, body);
      return { data };
    },
    { auth: true, body: InvestigationModel.createBody }
  )
  .get(
    "/:id",
    async ({ session, params, status }) => {
      const data = await InvestigationService.getById(
        params.id,
        session.userId
      );
      if (!data) return status(404, { message: "Investigation not found" });
      return { data };
    },
    { auth: true, params: InvestigationModel.idParam }
  )
  .delete(
    "/:id",
    async ({ session, params, status }) => {
      const data = await InvestigationService.delete(params.id, session.userId);
      if (!data) return status(404, { message: "Investigation not found" });
      return { data };
    },
    { auth: true, params: InvestigationModel.idParam }
  )
  .get(
    "/:id/report",
    async ({ session, params, status }) => {
      const report = await InvestigationService.getReport(
        params.id,
        session.userId
      );
      if (report === null)
        return status(404, { message: "Investigation not found" });
      if (!report) return status(404, { message: "Report not yet available" });
      return { data: report };
    },
    { auth: true, params: InvestigationModel.idParam }
  );
