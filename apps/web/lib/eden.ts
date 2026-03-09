import type { App } from "@api/index";
import { treaty } from "@elysiajs/eden";
import type { Treaty } from "@elysiajs/eden";

export const api: Treaty.Create<App> = treaty<App>("localhost:3001");
