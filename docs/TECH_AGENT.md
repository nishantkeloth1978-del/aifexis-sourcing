# Technical evaluation agent

**What it does:** for every bidder it drafts a score from 0 to 10 per criterion, with a short reason and word-for-word quotes from the bid. Quotes that cannot be found in the response are removed; a score with no verified quote becomes 0 ("no evidence"); each score stays inside the band of its assessment (meets 7 to 10, partly 4 to 6.9, does not meet 0 to 3.9).

**It never approves anything.** Drafts live in `tech_score_draft`, apart from real scores. In a manual event an evaluator reads a draft, clicks **Use these scores** (or **Use AI scores for all bidders**), edits if needed and saves the scores as their own. Approval still needs every evaluator's own scores.

**When it runs (manual events)**
- The buyer or a technical evaluator clicks **Evaluate all bidders with AI** on the Evaluation tab (or re-runs one bidder).
- Automatically, once, after the technical envelopes are opened, when the company switched it on (Configuration, next to the AI assistant setting). A person opening the envelopes starts it right after the response; the automatic run also picks up events whose envelopes opened by themselves.
- Per event, the buyer or an administrator can set the automatic run to Company default, On or Off, until the technical result is approved.
- Needs the AI review assistant switched on for the company and a Claude key (counts against the usual AI limits).

**Autopilot:** with the assistant on, Autopilot runs the same agent as its buyer and qualifies bidders whose total is above the company pass mark. Bidders that failed a mandatory gate are out. Autopilot holds for a person when a bidder's total is within 5 points of the pass mark, or when a third or more of the criteria have no supporting quote, or when the agent cannot finish. Without the assistant or a key, Autopilot keeps its earlier rule (mandatory gates only).

**Audit:** `evaluation.agent_run` per bidder (who or what started it, model, hash of the text, counts, never the content), `evaluation.agent_failed`, `evaluation.agent_switch`.

Migration: 0072_tech_agent.sql (`tech_score_draft`, `sourcing_event.ai_tech_eval`, `sourcing_event.ai_agent_tried_at`).
