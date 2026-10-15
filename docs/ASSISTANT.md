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
- Limits per person: 10 questions a minute and `ASSISTANT_DAILY_LIMIT` a day (default 100).
- Each question and answer is kept in `assistant_message` (per company, row-level security) with the page and which lookups ran. There is no review screen yet; an administrator can query it. Add a retention job when you decide how long to keep it.
- The conversation shown in the panel is kept in the browser tab only (sessionStorage) and is cleared with "New chat" or when the tab closes.

## Settings
`ANTHROPIC_API_KEY` (required for questions about company data and for changes; see "Free model first" below), `ASSISTANT_MODEL` (optional, falls back to `AI_MODEL`, then claude-sonnet-4-5), `ASSISTANT_DAILY_LIMIT` (optional).

## Not built yet
Supplier-side assistant, actions with confirmation (stage 3), streaming replies, a review screen for the log, more lookups (bids received, who invited, evaluation status).


## Stage 3: actions with confirmation, and streaming (migration 0050)

**Actions.** The assistant has one extra tool, `propose_action`, for four draft-only changes: `create_event`, `update_event` (title, department, closing date; draft only), `duplicate_event`, `add_item` (draft only). It never runs them. The server validates the details, stores a row in `assistant_action` (status `proposed`) and sends the browser a card built from the stored values, not from the model's words. Pressing **Confirm** calls `POST /api/assistant/action`, which atomically claims the row (`proposed` to `running`, same person only, under 15 minutes old, once) and runs the same service function the screens use, so permissions, draft-only rules and the audit trail are unchanged. A permission lost since the proposal blocks the change. **Cancel** or expiry changes nothing. One change per reply; 20 proposals per hour and 30 decisions per minute per person.

Not available to the assistant, by design: publish, invite suppliers, approve, award, cancel, delete, anything that sends email.

**Streaming.** `POST /api/assistant` with `"stream": true` answers as newline-delimited JSON: `{"t":"delta","x":"..."}` for text as it is written, `{"t":"round"}` when the model goes off to look something up (the browser clears the partial text), then `{"t":"done","out":{...}}` with the full result. Without `stream` the route answers with one JSON object as before.

**Review.** `assistant_action` holds kind, exact details, status and result per company; the assistant log (`assistant_message`) is unchanged.


## Free model first (migration 0051)

Questions about how the tool works are tried on a free or low-cost model first, and Claude answers everything else or whatever the free model cannot.

**Set in Vercel only (never in chat or the repo):** `GROQ_API_KEY`. Optional: `FREE_LLM_MODEL` (default `llama-3.3-70b-versatile`), `FREE_LLM_BASE_URL` (default Groq's OpenAI-compatible address; any OpenAI-compatible service works, with `FREE_LLM_API_KEY` instead of `GROQ_API_KEY`), `ASSISTANT_FREE=off` to switch it off. With no free key nothing changes.

**What the free model is given:** the person's latest question and the product guides. Nothing else: no company name, role, event reference or title, no lookup or change tools, none of the earlier conversation. Free tiers may keep or learn from what they receive, so company data never goes there.

**What never goes to it:** questions about the person's own events, bids or suppliers, questions that ask for a change, and anything asked on an event page (see `needsCompany` in `src/assistant/free.ts`). The free model can also hand a question up by answering ESCALATE (it is told to when the guides do not clearly cover it or the question depends on earlier messages).

**Fallback:** ESCALATE, an empty answer, an error, a timeout (20 s) or a rate limit all go to Claude. After a rate limit or server error the free model is skipped for a minute per server instance. If only a free key is set, how-to questions work and everything else says the assistant could not answer.

**Review:** `assistant_message.provider` is `free` or `claude`, so you can see how many questions the free model handled and check its answers. If its quality disappoints, set `ASSISTANT_FREE=off`.


## Choosing the models (Configuration screen, migration 0052)

An administrator (permission `config.manage`) sets this per company under **Configuration → Assistant models**: the mode (free model first, or Claude only), the free provider (Automatic, Groq, OpenRouter, Google Gemini or the server default), the free model name and the Claude model name. Empty names use the provider's default. Each choice has a **Test** button that sends one tiny request and says whether the key and model name work.

**Keys are never typed into the app.** The screen only shows whether each provider's key is set in the server environment: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FREE_LLM_API_KEY` (server default, with `FREE_LLM_BASE_URL` and `FREE_LLM_MODEL`) and `ANTHROPIC_API_KEY`. Provider addresses are fixed in the code, so an administrator cannot point company questions at an address of their own. Model names accept letters, digits and `. _ : / - @` only. Every save is written to the audit log (`assistant.settings`).

`ASSISTANT_FREE=off` still switches free models off for the whole deployment. The log in `assistant_message.provider` shows `free`, `claude`, `claude:data` (needed company data), `claude:no-free-key`, or `claude:free-<reason>` (the free model was tried and handed up: `http-401` bad key, `http-404` unknown model, `http-429` limit, `escalate`, `empty`, `timeout`, `cooldown`).
