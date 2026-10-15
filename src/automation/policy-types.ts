/** Client-safe parts of the automation policy (no server imports). */
export interface Policy { paused: boolean; reminderDays: number[]; extendEnabled: boolean; extendHours: number; extendMinBids: number; nudgeHours: number }
export const REMINDER_CHOICES = [1, 2, 3, 4, 5, 6, 7, 10, 14] as const;
export const DEFAULT_POLICY: Policy = { paused: false, reminderDays: [1], extendEnabled: false, extendHours: 48, extendMinBids: 1, nudgeHours: 48 };
export interface AutoAction { at: string; action: string; ref: string; detail: string }
