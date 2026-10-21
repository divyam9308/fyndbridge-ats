# CRM organisation summaries

The Add/Edit Client form places an optional About Organisation panel below the organisation/date row and above Contact 1. It has a 136px scroll area, bullet points, bold headings, manual editing and a Generate AI Summary action. The table previews five words in the column immediately after Organisation Name; View more opens the complete summary in a dialog.

## Rollout

Apply `supabase/migrations/20261021090008_crm_organisation_summary.sql` before deploying the application changes. It adds nullable `crm_clients.organisation_summary` and updates the existing service-only, security-invoker `crm_save` RPC atomically with its existing version checks and activity tracking. Existing records have no summary. The existing list RPC includes the field through its row JSON conversion. Applied to ATS FYNDBRIDGE (`owheruvatjcfqwsejnmo`) on 21 October 2026 as migration `20261021090008`. Read-only schema inspection confirmed the nullable JSONB field, summary-aware save function, SECURITY INVOKER, service-only execution grants and existing row-level security.

The backend uses `GEMINI_CRM_MODEL` (default `gemini-3.5-flash-lite`) and the existing primary/secondary Gemini credentials. It sends only the organisation name and optional sector hint to Google, with the Google Search tool enabled. Contact information and Gmail content are not sent. Source URLs and Google's Search suggestions accompany the summary. Source links use HTTPS; suggestions render in a sandboxed iframe without scripts or same-origin privileges. Summary text is rendered through React with a limited bold/link formatter, never raw HTML.

Generation is explicit, with a 25-second timeout per provider, a secondary-key attempt only on quota errors, and per-process caching/coalescing to reduce duplicate calls. A best-effort 30-second per-user cooldown applies to uncached requests; it is not a distributed rate limit. Cached summaries expire after 15 minutes. Neither generation nor opening the popup saves a record: Save persists the optional summary with the rest of the form. Changing the organisation name clears the draft overview to avoid saving another company's information. Changing name/sector or closing the form aborts the browser request and prevents stale results being applied; an already-running provider call may still finish on the server.

Research without web grounding, ambiguous companies and truncated answers produce an inline error rather than an invented or partial overview. Regeneration failures retain the previous draft. The prompt targets 200–250 words but permits shorter results when reliable information is sparse. Google Search grounding has its own quotas/pricing: https://ai.google.dev/gemini-api/docs/generate-content/google-search

## Manual acceptance (not run)

No tests, lint, build, browser checks or model API calls were run for this change, at the user's request. The user subsequently authorised applying the migration; only read-only schema/permission inspection followed the migration.

1. Add a client with a distinctive full company name; generate a summary. Confirm the panel position, compact height, internal scrolling, bullet headings and source links.
2. Edit the text, finish editing and save. Reload the table: the About Organisation column shows five words and View more opens the correct row's full overview. Close with Escape and the Close button.
3. Open Edit Client and confirm the saved overview. Save an unrelated status/contact change and confirm the summary is retained. Clear its text and save to remove it.
4. Try an ambiguous or nonexistent company. Confirm an inline message, optional manual entry and no blocked record creation after generation finishes.
5. Change the name while research is pending, then close/reopen the form. Confirm the old result is never applied. A failed regeneration must preserve an existing overview.
6. Check a record with no overview and the Date/Organisation sort buttons; verify existing contact selectors, comments, pagination and duplicate handling still work.
