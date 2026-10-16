import type { Pool } from "pg";
import { autoDraftRequest } from "@/agents/autodraft";
import { autopilotRequest } from "./autopilot";

/** What happens right after a request is saved: Autopilot (level 3) takes it when it may, otherwise the AI first draft (when switched on). Never throws. */
export async function afterRequestSaved(pool: Pool, tenantId: string, requestId: string): Promise<void> {
  try {
    if ((await autopilotRequest(pool, tenantId, requestId)) !== "skipped") return;
    await autoDraftRequest(pool, tenantId, requestId);
  } catch (e) { console.error("request intake failed", e instanceof Error ? e.message : e); }
}
