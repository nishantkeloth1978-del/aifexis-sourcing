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

**Not built yet** (see the development plan): the three AI agents, bid completeness checks and clarifications (these come with the bid reader), autonomy levels by value.

## The internal clock (worker)

A serverless host such as Vercel cannot keep a timer running, so the internal clock is a small always-on process: `scripts/worker.ts`. It runs one pass every 60 seconds (`WORKER_INTERVAL_SECONDS`, 15 to 600) by calling the same `tick` as the scheduler, directly against the database, and keeps going if a pass fails. It needs one setting, `DATABASE_URL` (the same value as the app), and nothing else.

- **Run it:** `npx tsx scripts/worker.ts`, or build `Dockerfile.worker` and run the container on any always-on host (a small Render, Railway or Fly.io background worker, or a server you already have).
- **Safe next to the scheduler:** each company is leased for up to two minutes while a pass works on it (`autonomy_run`, migration 0056), so the worker and the daily Vercel call never work on the same company at once. Keep the daily call as a backstop.
- **Visible:** the Automation screen shows the last run time and which runner did it, and warns if nothing has run for 15 minutes.

## Backup clock (page views)

If no worker is running, the app still runs the automatic steps while people use it: after a signed-in page is sent (`after()` in `src/ui/Shell.tsx`), `pageTick` runs a pass for that company when its last run was over a minute ago (migration 0057 allows the source `page`). It costs almost nothing, never delays the page, and shares the same per-company lease, so it cannot collide with the worker or the daily scheduler. It only runs while someone is signed in, so it is a backup, not a replacement: overnight and at weekends the worker (or the daily scheduler) is what runs.
