import { t, type UnwrapSchema } from "elysia";

export const InvestigationModel = {
  createBody: t.Object({
    title: t.String({ minLength: 1 }),
    targetType: t.Union([
      t.Literal("email"),
      t.Literal("phone"),
      t.Literal("domain"),
      t.Literal("ip"),
      t.Literal("username"),
      t.Literal("person"),
    ]),
    targetValue: t.String({ minLength: 1 }),
  }),

  idParam: t.Object({
    id: t.String(),
  }),

  investigationResponse: t.Object({
    id: t.String(),
    userId: t.String(),
    title: t.String(),
    targetType: t.String(),
    targetValue: t.String(),
    status: t.String(),
    createdAt: t.Date(),
    updatedAt: t.Date(),
  }),

  errorResponse: t.Object({
    message: t.String(),
  }),
} as const;

export type InvestigationModel = {
  [k in keyof typeof InvestigationModel]: UnwrapSchema<
    (typeof InvestigationModel)[k]
  >;
};
