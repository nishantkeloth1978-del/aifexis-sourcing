"use server";

// Demo server action. Replace the body with the real database write.
// The screen never waits for this: the UI updates first (see EventList), this runs in the background.
export async function copyEventAction(ref: string): Promise<{ ok: boolean; ref: string }> {
  await new Promise((r) => setTimeout(r, 1500));
  return { ok: true, ref };
}
