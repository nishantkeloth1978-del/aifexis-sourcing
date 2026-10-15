/** Client-safe shape of the monitoring panel. */
export interface AgentStat { agent: string; runs: number; failed: number; accepted: number; rejected: number }
export interface Monitor {
  days: number; awarded: number; medianCycleDays: number | null; avgSteps: number | null;
  auto: number; agents: AgentStat[]; openChecks: number; deadWebhooks: number; pendingWebhooks: number; newRequests: number;
}
