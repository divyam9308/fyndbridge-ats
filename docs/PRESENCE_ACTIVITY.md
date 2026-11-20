# Dashboard active time

The avatar tooltip replaces Page with **Today** and **Average**, in that order.
Presence/last-active metadata stays available. The quarter and financial year are
shown beneath Average so its scope is visible.

- Today uses the current IST date, independent of dashboard filters.
- Average follows the selected fiscal quarter (Q1 Apr–Jun, Q2 Jul–Sep,
  Q3 Oct–Dec, Q4 Jan–Mar). With the FY view, it uses the current fiscal-quarter
  number in the selected FY. With a month view, it uses that month's quarter.
- Average starts at the later of the quarter start and **21 November 2026**
  (the fixed tracking launch date, in IST). For Q3 FY 2026–27 it starts on
  21 November; Q4 starts on 1 January 2027, and subsequent quarters start normally.
  It never restarts at a user's first login or first recorded activity.
- The denominator is every elapsed Monday–Saturday date from that start, including
  today, except active holidays in the Attendance Holiday Calendar. This includes
  national, company, and optional holidays configured for those exact dates/years.
  Completed quarters use all their eligible dates; future quarters show 0.
- The numerator is active time on those same eligible dates. Sundays and holidays
  are excluded from both the total used for Average and its day count. Deactivated
  holidays count as ordinary days again. Holiday changes affect the next summary
  refresh; dates are not carried into other years automatically.
- Leave and absence never remove an otherwise eligible date from the divisor.
  An absent date contributes its actual recorded time, or zero. Today and stored
  activity history still include time spent on Sundays and holidays.
- Tracking starts when the migration and application changes are released.
  Earlier activity cannot be reconstructed and is excluded from Average. Eligible
  dates after launch with no activity count as zero, including absent days.

## Tracking and persistence

Activity is tracked across authenticated ATS pages. A visible, focused tab counts
until five minutes without pointer, keyboard, touch, or scroll input. Hidden,
blurred, and idle time pauses. Suspended timer gaps over two minutes are ignored.

The existing browser leader sends recent intervals with the 60-second heartbeat.
Tab close and sign-out flush pending intervals best-effort. An abrupt crash may
lose up to a heartbeat's unsent activity; it never credits the entire offline gap.
The dashboard refreshes summaries every 60 seconds while Realtime continues to
update presence. No global presence-list polling is added outside the dashboard.

`public.user_daily_activity` has one row per user/IST date. The database unions
ranges before calculating seconds, avoiding duplicate credit from overlapping
tabs/devices, retried heartbeats, and concurrent writes. Intervals are bounded to
the server's last 120 seconds. Midnight-crossing intervals split across dates;
no reset job or history deletion is required.

The daily table has RLS enabled and no browser access grants. Only service_role
can record intervals or read summaries. RLS intentionally has no client policies;
clients have no table grants. The API takes user identity from
`req.user.id`; client totals, dates, and user IDs are not accepted. Existing
inactive-employee filtering applies to the displayed presence list.

## Release and verification

Apply `supabase/migrations/20261120222043_user_daily_activity.sql` before deploying
the new server/client. Also apply
`supabase/migrations/20261120223343_presence_average_tracking_start.sql` to set the
average baseline. Existing clients remain compatible; they simply do not
supply activity intervals. New API code requires the migration.

Focused checks:

```sh
node --test src/services/presenceActivity.test.js server/src/services/presenceActivity.test.js server/src/services/presenceOptimization.test.js
npx playwright test server/browser-tests/presence-activity.spec.cjs --project=chromium --project=webkit
```

SQL tests execute the real migration/functions with PGlite, covering duplicate
intervals, server bounds, IST midnight, zero/missing workdays, Sunday/holiday exclusion,
and denied client access. Browser tests use real React hooks, Express presence
routes and PostgreSQL functions with synthetic users; they do not touch hosted
records. The presence rows themselves use an in-memory PostgREST adapter.
