# Fyndbridge ATS — Backend Documentation

## Tech Stack

| Concern | Library / Version |
|---|---|
| Runtime | Node.js |
| HTTP Framework | Express 4.x |
| Database client | `@supabase/supabase-js ^2.39.0` |
| AI | `@google/generative-ai ^0.24.1` (Gemini) |
| File upload | `multer ^1.4.5-lts.1` |
| PDF extraction | `pdf-parse ^1.1.1` |
| OCR fallback | `tesseract.js ^5.0.4` |
| HTTP requests | `axios ^1.6.5` |
| UUID generation | `uuid ^9.0.0` |
| Env config | `dotenv ^16.4.1` |

---

## Directory Structure

```
server/
├── server.js                        # Entry point – loads .env, validates AI config, starts HTTP
├── package.json
├── .env                             # Secret env variables (never committed)
├── .env.example                     # Template for required env vars
├── eng.traineddata                  # Tesseract OCR English language data
├── scripts/
│   └── seed-demo.js                 # Demo data seeder
├── src/
│   ├── app.js                       # Express app – registers CORS, auth middleware, all routes
│   ├── controllers/
│   │   ├── authController.js        # (stub) auth helper
│   │   ├── candidateController.js   # Core candidate CRUD, parse, filter, associations
│   │   ├── clientController.js      # Client CRUD, follow-ups, mandate links
│   │   ├── documentController.js    # Signed-URL serving for stored documents
│   │   ├── jobController.js         # Job/mandate CRUD, AI filter for jobs
│   │   ├── resumeController.js      # Bulk resume upload + open/serve resume
│   │   ├── userPreferenceController.js
│   │   └── userProfileController.js
│   ├── middleware/
│   │   ├── authMiddleware.js        # JWT Bearer token → req.user
│   │   └── uploadMiddleware.js      # Multer config for CV uploads (PDF/DOC/DOCX ≤ 10 MB)
│   ├── routes/
│   │   ├── ai.js                    # POST /api/ai/status
│   │   ├── auth.js                  # POST /api/auth/* (Supabase passthrough)
│   │   ├── candidates.js            # All /api/candidates/* endpoints
│   │   ├── clients.js               # All /api/clients/* endpoints
│   │   ├── documents.js             # GET /api/documents/open
│   │   ├── jobs.js                  # All /api/jobs/* endpoints
│   │   ├── resumes.js               # POST /api/resumes/bulk-parse, GET /api/resumes/open
│   │   ├── userPreferences.js
│   │   └── userProfiles.js
│   └── services/
│       ├── aiProvider.js            # Gemini wrapper with primary/secondary failover + quota handling
│       ├── cvStorage.js             # CV upload, hash dedup, Supabase Storage bucket ops
│       ├── documentStorage.js       # Generic document storage helpers
│       ├── extractorUtils.js        # Pure-JS regex heuristics for resume field extraction
│       ├── filterEngine.js          # AI-prompt→filter-JSON converter + local filter executor
│       ├── resumeParser.js          # Orchestrates PDF text → OCR → AI extraction pipeline
│       ├── storageBuckets.js        # Bucket name constants + storage path normalizer
│       ├── supabaseAdmin.js         # Supabase client using SERVICE_ROLE_KEY (admin, bypasses RLS)
│       └── supabaseAnon.js          # Supabase client using ANON_KEY (for user token validation)
└── supabase-*.sql                   # Migration scripts (applied manually in Supabase SQL editor)
```

---

## Entry Points

### `server/server.js`
- Loads `.env` from `server/.env`
- Calls `validateAiConfig()` (throws if Gemini keys are missing)
- Imports `app` from `src/app.js`
- Starts `app.listen(process.env.PORT || 4000)`

### `server/src/app.js`
- Creates the Express app
- Sets up **CORS** — allows `FRONTEND_URL`, `*.vercel.app`, and `localhost:*`
- Registers `express.json()` body parser
- Attaches `authMiddleware` globally (`req.user` is set on every authenticated request)
- Mounts all route files under `/api/...`
- Health check: `GET /api/health` → `{ status: 'ok' }`

---

## Route Reference

### `/api/candidates`

| Method | Path | Controller Method | Description |
|---|---|---|---|
| POST | `/parse-resume` | `parseResumeRoute` | Upload a CV → extract fields via AI |
| POST | `/ai-filter` | `buildAiCandidateFilters` | Natural-language query → filter JSON |
| GET | `/check-duplicate` | `checkCandidateDuplicate` | Check if name+mobile already exists |
| POST | `/check-cv-duplicate` | `checkCvDuplicate` | Hash-compare uploaded file against DB |
| GET | `/next-display-id` | `getNextCandidateDisplayId` | Preview the next CA### ID |
| GET | `/` | `listCandidates` | List all candidates (with association data) |
| POST | `/` | `createCandidate` | Create candidate + optional CV upload |
| GET | `/by-candidate/:candidateId/associations` | `listCandidateAssociations` | All associations for a candidate UUID |
| GET | `/:id` | `getCandidate` | Single candidate by association UUID |
| PATCH | `/:id/status` | `updateCandidateStatus` | Update status on association record |
| PATCH | `/:id` | `updateCandidate` | Full candidate edit + optional CV re-upload |
| DELETE | `/:id` | `deleteCandidate` | Delete candidate record |

### `/api/clients`

| Method | Path | Controller Method | Description |
|---|---|---|---|
| GET | `/check-duplicate` | `checkClientDuplicate` | Duplicate name check |
| GET | `/next-display-id` | `getNextClientDisplayId` | Preview next CL### ID |
| GET | `/` | `listClients` | List all clients |
| POST | `/` | `createClient` | Create client + optional contract document |
| GET | `/:id` | `getClient` | Single client detail |
| PATCH | `/:id` | `updateClient` | Update client + optional contract re-upload |
| POST | `/:id/follow-ups` | `addFollowUp` | Append a follow-up note to client |
| DELETE | `/:id` | `deleteClient` | Delete client |

### `/api/jobs`

| Method | Path | Controller Method | Description |
|---|---|---|---|
| GET | `/` | `listJobs` | List all jobs / mandates |
| GET | `/users/options` | `listJobUsers` | Consultant name options from profiles |
| GET | `/next-display-id` | `getNextJobDisplayId` | Preview next JB### ID |
| POST | `/ai-filter` | `buildJobFilters` | Natural-language query → mandate filter JSON |
| POST | `/` | `createJob` | Create job + optional JD upload |
| GET | `/:id` | `getJob` | Single job detail |
| PATCH | `/:id` | `updateJob` | Update job + optional JD re-upload |
| DELETE | `/:id` | `deleteJob` | Delete job |

### `/api/resumes`

| Method | Path | Description |
|---|---|---|
| POST | `/bulk-parse` | Upload up to 10 resumes at once; returns extracted fields array |
| GET | `/open` | Serve/proxy a stored resume from Supabase Storage (by `?path=`) |
| GET | `/open/:encodedPath` | Alt form with path in URL segment |

### `/api/documents`

| Method | Path | Description |
|---|---|---|
| GET | `/open` | Serve documents (JD PDFs, contract PDFs) via signed URL from Supabase Storage |

### `/api/auth`

Passes through to Supabase Auth (login, logout, session). Used by frontend.

### `/api/user-preferences`, `/api/user-profiles`

CRUD for per-user settings and profiles stored in Supabase.

---

## Middleware

### `authMiddleware.js` (`attachUser`)
- Reads `Authorization: Bearer <token>` header
- Validates the JWT with **supabaseAnon** client (`supabase.auth.getUser(token)`)
- Attaches `req.user = { id, email, name }` if valid
- Returns `401` if the token is present but invalid
- Allows requests with **no** `Authorization` header to pass through (some endpoints are public)

### `uploadMiddleware.js`
- Uses **Multer** with `dest: '/tmp/'` (disk storage, not memory)
- Accepts `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- File size limit: **10 MB**
- `handleUploadErrors` middleware converts Multer errors to JSON `400` responses

> **⚠️ Known Limitation**: Using `/tmp/` means uploaded files are stored in the OS temp directory. On Vercel Serverless, `/tmp/` is ephemeral and limited in size. This works locally but may cause issues under concurrent serverless load.

---

## Services

### `aiProvider.js` — Gemini AI Wrapper

- Manages **two Gemini API keys**: `PRIMARY` (`GEMINI_API_KEY_PRIMARY`) and `SECONDARY` (`GEMINI_API_KEY_SECONDARY`)
- Model: set by `GEMINI_MODEL` env var (default `'gemini-3.1-flash-lite'`)
- System instruction forced on every call: `"Return valid JSON only. Do not include markdown or explanatory text."`
- **Failover logic**: If PRIMARY returns a quota/429 error → tries SECONDARY → if SECONDARY also quota-exhausted → retries PRIMARY once → throws `AI_QUOTA_REACHED`
- 30-second per-request timeout
- `callAiJson({ prompt, schema, temperature, schemaName })` — the main export; returns parsed JSON
- `generateAIResponse(prompt, options)` — raw text response
- `extractJsonText(text)` — strips markdown code fences and extracts the first JSON object/array
- Fires a `window.dispatchEvent('ai-quota-reached')` message upstream so the frontend can show a banner

**Key exports**: `callAiJson`, `generateAIResponse`, `getAiStatus`, `validateAiConfig`, `GEMINI_MODEL`

---

### `filterEngine.js` — AI Filter Engine

Converts a natural-language search string into a structured filter object, then applies it to in-memory candidate/mandate rows.

**Two modes**:
1. **AI path**: `buildAiFilterPrompt()` → sends to Gemini → `validateAiFilters()` normalizes the result
2. **Local fallback** (`parsePrompt()`): Pure regex-based parser used when AI returns nothing useful

**Supported filter fields** (candidates):
`candidate_id`, `candidate_name`, `consultant`, `email`, `mobile`, `designation`, `organisation`, `experience`, `client_id`, `client_name`, `role`, `date`, `skills`, `current_ctc`, `current_location`, `notice_period`, `expected_ctc`, `open_to_relocate`, `comments`, `status`, `month`, `linkedin`, `cv`

**Supported filter fields** (mandates/jobs):
`job_id`, `consultant`, `team_lead`, `client_name`, `role`, `location`, `budget`, `mandate_status`, `vertical`, `date_of_allocation`

**Supported operators**: `contains`, `equals`, `not_equals`, `starts_with`, `ends_with`, `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`, `between`, `before`, `after`, `on`, `is_empty`, `is_not_empty`, `in`

**Type normalizers**: text, id, number, money (LPA/Cr conversion), date, enum, boolean, budget, mandate_status

**Key exports**: `buildAiFilterPrompt`, `validateAiFilters`, `applyFilters`, `parsePrompt`, `aiFilterSchema`

---

### `cvStorage.js` — CV Upload & Deduplication

- Supabase Storage bucket: `resumes` (`STORAGE_BUCKETS.CV`)
- `prepareUploadedCv(file)`: Computes SHA-256 of file buffer → checks DB for existing hash → if found, reuses URL; if not, uploads and returns new public URL
- `checkUploadedCvDuplicate(file)`: Hash check only, no upload
- `checkLinkedCvDuplicate(link)`: Checks if a URL already exists in `cv_link` or `resume_url` columns
- `prepareLinkedCv(link)`: Normalizes a linked CV URL for storage
- Storage object path pattern: `{sha256_hash}{.ext}` (hash-based deduplication)

---

### `resumeParser.js` — Resume Parsing Pipeline

1. Read file buffer from `/tmp/` path
2. **PDF text extraction** via `pdf-parse`
3. If extracted text < 100 chars → **OCR fallback** via `tesseract.js` (English trained data)
4. **Heuristic extraction** via `extractorUtils.js` (regex-based, no AI)
5. **AI extraction** via Gemini — fields: `name`, `email`, `mobile`, `city`, `state`, `currentDesignation`, `experience`, `education`, `skills`, `salary`, `linkedin`, `summary`
6. AI results merged with heuristic results (AI takes priority, heuristics fill missing fields)
7. Returns `{ extracted, ai_extracted, raw_text }`

**Education filtering**: AI is instructed to exclude certifications, workshops, bootcamps, and short courses from education.

---

### `extractorUtils.js` — Pure-JS Heuristic Extraction

Used as the fallback if AI fails. Extracts:
- `extractEmail(text)` — regex
- `extractPhone(text)` — labelled phone pattern → fallback to phone-like numbers; strips Indian country code `+91`
- `extractName(text)` — reads first 5 lines, filters headers and numbers
- `extractExperience(text)` — finds date ranges in Professional Experience section
- `extractCurrentDesignation(text)` — first dated role under Professional Experience section
- `extractCurrentCompany(text)` — line after current role title
- `extractSkills(text)` — Skills/Tech Stack section content
- `extractEducation(text)` — Education section lines
- `extractCity(text)` / `extractState(text)` — hardcoded Indian city/state dictionary
- `extractSalary(text)` — only when near compensation keywords (LPA/lakhs/CTC)
- `extractCoverLetter(text)` — auto-generates a recruiter-facing cover letter paragraph

All extractors return `{ value, confidence: 'high' | 'low' }`.

---

### `storageBuckets.js` — Storage Path Utilities

**Buckets**:
| Key | Bucket Name | Used For |
|---|---|---|
| `CV` | `resumes` | Candidate CVs |
| `JD` | `jds` | Job Description PDFs |
| `CONTRACT` | `contract-pdfs` | Client contract documents |

`normalizeStoragePath(value, bucketName)` strips bucket prefixes, legacy bucket names, and Supabase storage URL prefixes to yield a clean object path. Handles both full public URLs and partial paths.

`documentOpenUrl(type, pathOrUrl)` builds a `/api/documents/open/{type}?path=...` proxy URL for the frontend.

---

### `supabaseAdmin.js`
- Creates Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (full admin, bypasses all RLS)
- `autoRefreshToken: false`, `persistSession: false`
- Used by **all backend DB operations** (inserts, queries, storage uploads)

### `supabaseAnon.js`
- Creates Supabase client with `SUPABASE_ANON_KEY`
- Used **only** by `authMiddleware.js` to validate user JWT tokens via `supabase.auth.getUser(token)`

---

## Auth Handling

Authentication is **delegated to Supabase Auth** (email/password with Google OAuth optionally enabled). The backend:
1. Receives `Authorization: Bearer <supabase_jwt>` on protected requests
2. `authMiddleware.js` calls `supabase.auth.getUser(token)` using the Anon key
3. `req.user` is attached if valid
4. Backend does **not** enforce auth on routes — routes that need `req.user` use it; routes that don't, ignore it

**Domain restriction**: The frontend enforces `@fyndbridge.in` email domain only (see `AuthContext.jsx`). The backend itself has no domain enforcement.

---

## File Upload Flow

### CV / Resume Upload
```
Client → POST /api/candidates (multipart/form-data, field: cv_file)
  → uploadMiddleware (Multer: save to /tmp/, validate type/size)
  → candidateController.createCandidate
    → cvStorage.prepareUploadedCv(file)
      → SHA-256 hash → check existing in DB
      → if new: supabase.storage.from('resumes').upload(hash+ext, buffer)
      → returns { cv_link, resume_url, cv_file_hash, cv_storage_path }
    → save candidate row to Supabase with cv_link, resume_url, cv_file_hash, cv_storage_path
```

### JD Upload
```
Client → POST /api/jobs (multipart/form-data, field: jd_file)
  → uploadMiddleware → jobController.createJob
    → supabase.storage.from('jds').upload(uuid+ext, buffer)
    → saves jd_url, jd_storage_path to jobs table
```

### Contract Upload
```
Client → POST /api/clients (multipart/form-data, field: contract_document_file)
  → multer (memory storage, 10 MB) → clientController.createClient
    → supabase.storage.from('contract-pdfs').upload(...)
```

---

## Display ID System

All three entity types use short human-readable IDs:

| Entity | Prefix | Example | Mechanism |
|---|---|---|---|
| Candidates | `CA` | `CA42` | PostgreSQL sequence `candidate_display_id_seq` + DB trigger `candidates_display_id_before_insert` |
| Clients | `CL` | `CL7` | Gap-filling SQL function `assign_client_display_id()` (finds lowest available number) |
| Jobs | `JB` | `JB15` | Managed in `jobController.js` via `getNextJobDisplayId` route |

**Candidate ID gap-filling**: The controller's `getNextCandidateDisplayId` endpoint queries existing `candidate_display_id` values, finds the lowest positive integer not yet used, and returns `CA{n}`. This ensures deleted candidate IDs are reused.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (admin, backend only) |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon key (for auth token validation) |
| `GEMINI_API_KEY_PRIMARY` | ✅ | Primary Gemini API key |
| `GEMINI_API_KEY_SECONDARY` | ✅ | Secondary Gemini API key (quota failover) |
| `GEMINI_MODEL` | ✅ | Gemini model name (e.g. `gemini-3.1-flash-lite`) |
| `FRONTEND_URL` | ✅ | Frontend URL for CORS allowlist (e.g. `https://fyndbridge.vercel.app`) |
| `PORT` | ❌ | HTTP port (defaults to `4000`) |

---

## Known Issues / TODOs

- **`/tmp/` storage on Vercel**: Multer saves files to `/tmp/`. On Vercel Serverless, `/tmp/` has a 512 MB cap and is ephemeral — this can cause issues for large files or concurrent requests.
- **Tesseract trained data**: `eng.traineddata` is bundled in the server directory (5.2 MB). This is loaded at OCR time by `tesseract.js`.
- **No route-level auth enforcement**: All routes pass through `attachUser` but the actual presence of `req.user` is not validated per-route. Any request without a token will have `req.user = undefined` and will not be blocked at the route level.
- **AI quota reached is silent on the backend**: When both Gemini keys are exhausted, an `AI_QUOTA_REACHED` error is thrown. The frontend listens for this and shows a banner, but the backend does not log or alert on this.
