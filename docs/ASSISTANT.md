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
`ANTHROPIC_API_KEY` (required), `ASSISTANT_MODEL` (optional, falls back to `AI_MODEL`, then claude-sonnet-4-5), `ASSISTANT_DAILY_LIMIT` (optional).

## Not built yet
Supplier-side assistant, actions with confirmation (stage 3), streaming replies, a review screen for the log, more lookups (bids received, who invited, evaluation status).
