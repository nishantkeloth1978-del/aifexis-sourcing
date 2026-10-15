# In-app assistant

A side panel ("Ask Aifexis", top right of every staff page) that answers questions about the tool and about the signed-in person's own events.

## What it does (stage 1 and read-only stage 2)
- Answers "how do I…" questions from short guides (`src/assistant/kb.ts`), picked by keyword from the question and the page.
- Looks things up for the signed-in person only: `list_events` (status, closing soon, search) and `event_status` (what is missing before an event can be submitted). `src/assistant/tools.ts`. These call the same service functions as the screens, so company isolation and "only events you may see" apply. No values, prices or documents are returned.
- It cannot change anything. Creating, inviting, approving and awarding stay with the person.

## Safety
- The Anthropic key is read on the server only (`ANTHROPIC_API_KEY`, already used by AI templates). Without it the button does not appear.
- Event titles and other text are treated as data, never instructions (stated in the prompt; tool results are returned as tool results).
- Only a known shape of page path is given to the model. Messages are limited to 16 turns, 2000 characters each; replies show only relative links and are rendered without HTML.
- Limits per person: 10 questions a minute and a daily number set by an administrator on the Configuration screen (default 100, 1 to 5000; migration 0054).
- Each question and answer is kept in `assistant_message` (per company, row-level security) with the page and which lookups ran. There is no review screen yet; an administrator can query it. Add a retention job when you decide how long to keep it.
- The conversation shown in the panel is kept in the browser tab only (sessionStorage) and is cleared with "New chat" or when the tab closes.

## Settings
**No AI setting lives in Vercel.** Every key, model and limit is entered in the app under Configuration > Assistant models. The Claude key entered there is also used by AI templates, message drafting and evaluation help for that company.

## Not built yet
Supplier-side assistant, actions with confirmation (stage 3), streaming replies, a review screen for the log, more lookups (bids received, who invited, evaluation status).


## Stage 3: actions with confirmation, and streaming (migration 0050)

**Actions.** The assistant has one extra tool, `propose_action`, for four draft-only changes: `create_event`, `update_event` (title, department, closing date; draft only), `duplicate_event`, `add_item` (draft only). It never runs them. The server validates the details, stores a row in `assistant_action` (status `proposed`) and sends the browser a card built from the stored values, not from the model's words. Pressing **Confirm** calls `POST /api/assistant/action`, which atomically claims the row (`proposed` to `running`, same person only, under 15 minutes old, once) and runs the same service function the screens use, so permissions, draft-only rules and the audit trail are unchanged. A permission lost since the proposal blocks the change. **Cancel** or expiry changes nothing. One change per reply; 20 proposals per hour and 30 decisions per minute per person.

Not available to the assistant, by design: publish, invite suppliers, approve, award, cancel, delete, anything that sends email.

**Streaming.** `POST /api/assistant` with `"stream": true` answers as newline-delimited JSON: `{"t":"delta","x":"..."}` for text as it is written, `{"t":"round"}` when the model goes off to look something up (the browser clears the partial text), then `{"t":"done","out":{...}}` with the full result. Without `stream` the route answers with one JSON object as before.

**Review.** `assistant_action` holds kind, exact details, status and result per company; the assistant log (`assistant_message`) is unchanged.


## Free model first (migration 0051)

Questions about how the tool works are tried on a free or low-cost model first, and Claude answers everything else or whatever the free model cannot.

**Keys come from the app.** Add a Groq (or OpenRouter, Gemini) key on the Configuration screen. With no free key the assistant goes straight to Claude; with no key at all the assistant is off.

**What the free model is given:** the person's latest question and the product guides. Nothing else: no company name, role, event reference or title, no lookup or change tools, none of the earlier conversation. Free tiers may keep or learn from what they receive, so company data never goes there.

**What never goes to it:** questions about the person's own events, bids or suppliers, questions that ask for a change, and anything asked on an event page (see `needsCompany` in `src/assistant/free.ts`). The free model can also hand a question up by answering ESCALATE (it is told to when the guides do not clearly cover it or the question depends on earlier messages).

**Fallback:** ESCALATE, an empty answer, an error, a timeout (20 s) or a rate limit all go to Claude. After a rate limit or server error the free model is skipped for a minute per server instance. If only a free key is set, how-to questions work and everything else says the assistant could not answer.

**Review:** `assistant_message.provider` is `free:<provider>` or `claude` (with a reason when a free model was skipped), so you can check how many questions the free model handled. To stop using free models choose "Claude only" or remove the keys.


## Choosing the models and entering API keys (Configuration screen, migrations 0052 and 0053)

An administrator (permission `config.manage`) sets this per company under **Configuration → Assistant models**:

- **Mode:** free model first for how-to questions (Claude for everything else), or Claude only.
- **Free providers (Groq, OpenRouter, Google Gemini):** an order (position 1 is tried first), a model name each (empty = the provider's default) and an API key each.
- **Claude:** a model name and an API key, entered here.
- **Test** on every provider sends one tiny request with the key and model name in force and says what is wrong ("rejected the key", "unknown model name", "limit reached", "no key").
- A "this month" line counts answers by free models, by Claude, and questions the free model handed up.

**Keys.** Typed into the app, sent over HTTPS, encrypted on the server with AES-256-GCM (`src/assistant/keys.ts`) and stored in `assistant_key`. The encryption key is derived from the existing `SIGNING_SECRET`; if that secret is rotated, the stored keys can no longer be read and must be entered again. Each value is bound to its company and provider. Keys are write-only: only the last four characters are shown afterwards. Only `config.manage` can add, replace, remove or test keys, and each change is audited (`assistant.key.set`, `assistant.key.removed`; never the key itself). Keys are never written to logs, the page or the address.

**No server fallback.** A key the company has not entered is not used; the server environment is never read for AI.

**Provider addresses are fixed in the code** (`PROVIDERS` in `src/assistant/models.ts`): a company's key can only ever be sent to the real provider. Model names accept letters, digits and `. _ : / - @` only.

**How a question is answered.** Free providers are tried in the company's order; a provider that fails (error, limit, timeout) is skipped for a minute and the next is tried; a provider that hands the question up (ESCALATE) ends the free attempts; then Claude answers. `assistant_message.provider` records the result: `free:<provider>`, `claude`, `claude:data` (needed company data), `claude:no-free-key`, or `claude:free-<reason>` (`http-401` bad key, `http-404` unknown model, `http-429` limit, `escalate`, `empty`, `timeout`, `cooldown`).
