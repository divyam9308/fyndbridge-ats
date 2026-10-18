# Inactive employees in attendance, leave and PMS

Date: 18 October 2026. Repository: `divyam9308/fyndbridge-ats`, branch `main`.

## Behavior

- Current and future Team Attendance and Leave Balance lists omit inactive employees. Employees marked On Leave remain in the monthly attendance and leave populations.
- Completed attendance months and financial years retain former employees who were employed during that period. The **Show past employees** control exposes history for a partially completed month or financial year. A future period starting after departure still excludes them.
- Today's Present/Leave/Unmarked lists continue to use the current eligible population, even while viewing a historical month.
- Historical attendance records, correction requests, leave requests, ledger entries and performance reviews are retained. The calendar marks post-departure days Inactive; expected working days and unmarked absence counts stop at departure.
- New leave accrual and carry-forward entries stop before the inactivation date. Existing ledger entries are preserved. Former employee balances are read-only, enforced by the adjustment API.
- Approving a request cannot generate attendance/leave on or after departure. Existing requests remain stored, and pre-departure records remain available.
- PMS omits inactive employees from the normal selector. **Show past employees with saved reviews** exposes only stored reviews for the selected quarter. These reviews are read-only. Opening a former employee's history cannot create a missing quarter or overwrite partial historical rows with defaults.
- Missing archived PMS quarters return 404; writes for an inactive employee return 409. Access to another employee's PMS still requires Super Admin.
- Existing employee-status Realtime events refresh open attendance and leave lists and update the PMS selector. No second employee-status subscription or polling was added.
- Reactivation restores ordinary roster eligibility and PMS editing. Re-saving an unchanged status preserves its timestamp.

## Date source and scope

The departure boundary is the company-local date of the existing `employee_statuses.updated_at` timestamp. The schema stores the current status, not a complete employment timeline. The code does not invent earlier departure dates or separate historic rehire intervals. All persisted records remain intact. No schema migration or production data cleanup is required.

## Verification

The focused tests exercise real attendance/PMS services and Express routes against an isolated Supabase-shaped memory adapter. Browser tests use synthetic staff, records, authentication and Realtime frames; they do not mutate production Supabase data.

- Full backend suite, including access/security tests: **739 passed**.
- Changed JavaScript/JSX files: ESLint passed. CJS test fixtures also pass Node syntax checks.
- Production build: passed with explicit synthetic Supabase configuration.
- Full Chromium and WebKit regression suite and compiled-build scenarios are recorded in `outputs/inactive-employee-verification/results.json`.
- Browser checks cover current/past/future attendance, calendar history, leave history, API write rejection, saved PMS quarters, reactivation, live inactivation and a settled render count. Existing Applied Candidates columns, bulk deletion, dock animation, scroll locking and table formatting remain covered by the regression suite.
- Screenshots in the evidence folder were visually inspected. They contain synthetic data only.

Repository-wide lint remains at its pre-existing baseline: **886 errors and 3 warnings**, including generated `.vercel` output. Excluding `.vercel` gives **41 errors and 3 warnings**, all in unchanged files; see `lint-summary.json`. Firefox is not claimed as verified; its browser launch was already unavailable on this host in the preceding verification. No dependency versions, RLS rules or authentication permissions were changed.
