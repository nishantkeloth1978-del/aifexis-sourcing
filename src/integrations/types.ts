/** Client-safe types for the integration layer (no server imports). */
export const WEBHOOK_EVENTS = ["request.accepted", "request.rejected", "event.published", "event.closed", "award.approved"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const SCOPES = ["requests:write", "requests:read", "awards:read"] as const;
export interface ClientInfo { id: string; name: string; keyPrefix: string; scopes: string[]; webhookUrl: string | null; webhookEvents: string[]; active: boolean; lastUsedAt: string | null; createdAt: string; pending: number; dead: number }
export interface DeliveryInfo { id: number; clientName: string; eventType: string; state: "pending" | "delivered" | "dead"; attempts: number; lastStatus: number | null; lastError: string | null; createdAt: string; nextAttemptAt: string | null }
export interface IntegrationScreen { clients: ClientInfo[]; deliveries: DeliveryInfo[] }
