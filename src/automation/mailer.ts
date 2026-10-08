/** Sends one e-mail. With RESEND_API_KEY and MAIL_FROM set it uses Resend; otherwise it only logs (nothing leaves the system). */
export type SendResult = { ok: true; mode: "sent" | "logged" } | { ok: false; error: string };

export async function sendMail(to: string, subject: string, body: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  if (!key || !from) { console.log(`[mail:logged] to=${to} subject=${subject}`); return { ok: true, mode: "logged" }; }
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });
    if (!r.ok) return { ok: false, error: `Mail service answered ${r.status}` };
    return { ok: true, mode: "sent" };
  } catch { return { ok: false, error: "Mail service could not be reached" }; }
}
