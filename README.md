#[ React + Vite ]

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project...
......
## Automatic CV branding

New CV uploads in Candidates (including multiple attachments and parsed uploads),
Assigned Candidates, and CVs adopted from public applications share the same
branding queue. Existing saved CVs are not rewritten.

The official full vector artwork is stored at `server/assets/fyndbridge-cv-logo.pdf`.
It was extracted without redrawing from the supplied `FYNDBRIDGE-LOGO (1).pdf`
(SHA-256 `4f7d4546d6adc525f8429fcb931bd9e7c7d26f0c4c3d278d798c09f3e24c6e69`).
The shared configuration fixes the width at 45 mm, opacity at 60%, and top/left
clearance at 7.5 PDF points (10 CSS pixels at 96 DPI). All pages are stamped over
existing content using transparent multiply compositing; page boxes, rotation,
fonts and selectable text are preserved. This also works when the CV paints an
opaque background, while black text remains black.

### Storage and completion

Apply `supabase/migrations/20261124190100_cv_branding_jobs.sql` before running this
version. Originals are staged in the private `cv-branding-staging` bucket, which
has no user policies. Jobs and worker claims are service-role only. The final
path is reserved immediately, while opening is blocked by both the row icon and
the server. A worker saves and downloads the branded PDF to verify it, deletes
the original, and only then marks the job ready. Only the branded PDF remains in
`resumes`. Failures retain the private original for a safe retry; they never
silently expose the unbranded CV.

The CV icon polls batched authorised statuses while processing and displays an
overlaid spinner. It becomes the normal clickable CV icon on completion. Failed
processing shows a retry action instead of an endless spinner. Access is checked
against the candidate record or the assignment's existing owner/permission rules.

Vercel runs request-triggered work using `waitUntil` and recovers persisted jobs
through `/api/cron/cv-branding` every minute. Configure the existing `CRON_SECRET`
in Vercel. The long-lived Node server also runs recovery every 30 seconds. Claims
have leases, making restarts and concurrent workers retryable. Deleting a CV
cancels pending work and preserves files still referenced by another record.
Unreferenced abandoned uploads are cleaned after 24 hours.

### Word CVs

PDFs require no extra service. To enable DOC/DOCX uploads, configure
`CV_WORD_CONVERTER_URL` with the base URL of a private Gotenberg service reachable
from the backend. It must support `POST /forms/libreoffice/convert`. An optional
`CV_WORD_CONVERTER_TOKEN` supplies bearer authentication to its reverse proxy.
The original is sent only to this configured service for layout-preserving PDF
conversion, then the resulting PDF is stamped by the same worker. Word input is
not flattened into extracted text. Until a converter is configured, Word uploads
are rejected with an explicit PDF-upload instruction; an unbranded Word file is
never presented as a completed branded CV.

Focused checks: `node --test server/src/services/cvBranding.test.js`.

### CV transfer integrity and duplicate cleanup

The CV management follow-up adds durable, retryable Assigned Candidates transfers,
verified source-content deduplication and atomic storage deletion claims. Only an
explicit new transfer can stage an existing legacy Assigned CV; historical Main
Candidates reads and duplicate cleanup never trigger branding.

Apply the new `20261125210111_cv_transfer_identity_and_storage_integrity.sql`
migration during the coordinated application rollout. See
[the implementation and deployment report](docs/CV_MANAGEMENT_FIX.md) for the safe
order, verification results, artwork discrepancy and bounded cleanup commands.
