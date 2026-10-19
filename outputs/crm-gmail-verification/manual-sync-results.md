# Manual Gmail synchronization verification

The connected Gmail toolbar and connection dialog now expose **Sync now**. A click
runs the authenticated caller's discovery and analysis immediately in a bounded HTTP
request, with disabled duplicate actions and a **Syncing...** state. The existing
minute worker continues durable unfinished work. Result/error messages remain in the
dialog and do not change toolbar layout. Existing hourly discovery remains intact.

Validation:

- Full backend suite: **825 passed, 0 failed**.
- Final compiled-build Gmail checks in Chromium and WebKit: **8 passed, 0 failed**.
- Existing CRM regression checks in both browsers: **16 passed** in the broader run.
- The broader 24-check run initially had one Chromium test assertion execute before
  its intercepted network request arrived (23 passed, 1 failed). The assertion now
  waits for that request; the final eight Gmail checks above include the corrected
  case in both browsers. No timing sleeps were added.
- Changed JS/JSX lint, CJS syntax, `git diff --check`, and production build passed.

Backend tests execute the real migration and RPCs in isolated PostgreSQL, including
service-role access and denial for browser roles. They prove caller-only claims,
immediate history creation, deduplication, concurrent persisted cooldown, worker-busy
queue recovery, authorization, work-email verification and provider backoff/quota
preservation. HTTP tests ignore a forged body `user_id` and verify responses exclude
credentials. Browser tests use real Express/SQL orchestration with synthetic Google
and AI providers, then open the existing Activity History to verify the persisted
email. Screenshots contain only synthetic data; `manual-sync.png` shows the result.

Requires migration `20261019182711_crm_gmail_manual_sync.sql` followed by application
deployment. Neither hosted migration nor deployment nor live mailbox access was
performed by this manual-sync task. No secrets, dependencies or cron schedules were
changed. Unrelated regenerated CRM screenshots were restored to their entry state.
