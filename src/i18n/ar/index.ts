import { AR_ADMIN } from "./admin";
import { AR_EVALCOMMERCIAL } from "./evalcommercial";
import { AR_MESSAGES } from "./messages";

/** Every Arabic phrase for the screens translated by English key (see ../tx.ts). */
export const AR: Record<string, string> = { ...AR_EVALCOMMERCIAL, ...AR_ADMIN, ...AR_MESSAGES };
