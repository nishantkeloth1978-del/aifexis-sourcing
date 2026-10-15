import { AR_ADMIN } from "./admin";
import { AR_EVALCOMMERCIAL } from "./evalcommercial";
import { AR_MESSAGES } from "./messages";
import { AR_MESSAGING } from "./messaging";
import { AR_USERS } from "./users";
import { AR_DECISIONS } from "./decisions";
import { AR_LOTS } from "./lots";
import { AR_HARDENING } from "./hardening";
import { AR_MASTERS } from "./masters";
import { AR_TEMPLATES } from "./templates";
import { AR_FREIGHT } from "./freight";
import { AR_ASSISTANT } from "./assistant";
import { AR_AUTOMATION } from "./automation";
import { AR_REQUESTS } from "./requests";
import { AR_INTEGRATIONS } from "./integrations";
import { AR_AGENTS } from "./agents";
import { AR_BIDCHECK } from "./bidcheck";

/** Every Arabic phrase for the screens translated by English key (see ../tx.ts). */
export const AR: Record<string, string> = { ...AR_EVALCOMMERCIAL, ...AR_ADMIN, ...AR_MESSAGES, ...AR_MESSAGING, ...AR_USERS, ...AR_DECISIONS, ...AR_LOTS, ...AR_HARDENING, ...AR_MASTERS, ...AR_TEMPLATES, ...AR_FREIGHT, ...AR_ASSISTANT, ...AR_AUTOMATION, ...AR_REQUESTS, ...AR_INTEGRATIONS, ...AR_AGENTS, ...AR_BIDCHECK };
