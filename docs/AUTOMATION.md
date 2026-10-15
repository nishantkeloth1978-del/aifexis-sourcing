# Automation (autonomous sourcing, phases 0 and 1)

The scheduled run `/api/cron/tick` (daily, see `vercel.json`, protected by `CRON_SECRET`) does the following for every company, safe to run as often as you like:

1. **Extend once** (`extendDeadlines`): only if the company switched it on, the event is published, closes within the next 24 hours, has fewer bidding suppliers than the company's minimum, and was never extended before. Extends by the company's hours (1 to 168). Invited suppliers and buyers are told. Runs before closing so an extended event is not closed in the same run.
2. **Close** (`autoClose`): events past their closing time are closed through the normal lifecycle rules. Closing is never paused, because it enforces the published deadline.
3. **Remind suppliers** (`sendReminders`): invited suppliers who have not bid, at the days before closing the company chose (default: 1). One message per supplier per run (the smallest applicable day); larger days that already passed are recorded, not sent.
4. **Remind approvers** (`nudgeApprovers`): approvers who have not decided on an event waiting in "pending publication" or "pending award" longer than the company's limit (default 48 hours, 0 = never). At most one per approver per period.
5. **Send queued e-mail** (`flushOutbox`).

**Settings:** Configuration > Automation (`config.manage`). Stored in `autonomy_policy` (migration 0055); defaults reproduce the earlier behaviour (one reminder a day before closing, nothing else). **Pause automation** stops reminders, extensions and approver reminders; closing continues.

**Record:** every automatic step writes an audit event named `autonomy.auto_*` (close, remind, extend, nudge) by actor `system`; the Configuration screen lists the most recent ones. Policy changes are audited as `autonomy.policy`.

**Schedule:** the daily schedule is the Hobby-plan limit. On a plan that allows it, change the schedule in `vercel.json` to hourly (`0 * * * *`) for faster reminders; all rules are written to be repeated safely.

**Not built yet** (see the development plan): request intake, integration layer, the three AI agents, bid completeness checks and clarifications (these come with the bid reader), autonomy levels by value.
