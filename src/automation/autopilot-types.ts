/** Client-safe parts of Autopilot (level 3). */
export const AUTOPILOT_DOMAIN = "autopilot.invalid";
export const AUTOPILOT_SEATS = ["buyer", "approver", "witness"] as const;
export type AutopilotSeat = (typeof AUTOPILOT_SEATS)[number];
/** The three Autopilot identities are ordinary members with a made-up address nobody can sign in with or receive mail at. */
export const isAutopilotEmail = (email: string) => email.toLowerCase().endsWith(`@${AUTOPILOT_DOMAIN}`);
export const autopilotEmail = (tenantId: string, seat: AutopilotSeat) => `autopilot-${seat}-${tenantId}@${AUTOPILOT_DOMAIN}`;
/** How an audit actor is shown: the made-up address becomes "Autopilot (seat)". */
export const actorLabel = (actor: string) => { const m = /^autopilot-(buyer|approver|witness)-[0-9a-f-]{36}@autopilot\.invalid$/i.exec(actor); return m ? `Autopilot (${m[1]})` : actor; };

export interface AutopilotInfo { autopilot: boolean; hold: string | null; canTakeOver: boolean; state: string }
