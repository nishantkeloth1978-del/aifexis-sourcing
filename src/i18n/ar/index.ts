import { AR_ADMIN } from "./admin";
import { AR_EVALCOMMERCIAL } from "./evalcommercial";
import { AR_MESSAGES } from "./messages";
import { AR_LOTS } from "./lots";
import { AR_HARDENING } from "./hardening";
import { AR_MASTERS } from "./masters";

/** Every Arabic phrase for the screens translated by English key (see ../tx.ts). */
export const AR: Record<string, string> = { ...AR_EVALCOMMERCIAL, ...AR_ADMIN, ...AR_MESSAGES, ...AR_LOTS, ...AR_HARDENING, ...AR_MASTERS };
