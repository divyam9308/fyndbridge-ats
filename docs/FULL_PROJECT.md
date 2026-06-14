# Fyndbridge ATS — Full Project Documentation

## Project Overview

**Fyndbridge ATS** is an internal Applicant Tracking System (ATS) built for Fyndbridge recruiters.
It manages the full recruitment pipeline: clients → job mandates → candidates → association/status tracking.

The system is designed as a two-tier web app:
- **Frontend**: React SPA deployed on Vercel
- **Backend**: Express API server deployed on Vercel Serverless Functions (or standalone Node)
- **Database + Auth + Storage**: Supabase (managed Postgres + Auth + S3-compatible Object Storage)

---

## Architecture Overview

```
┌──────────────────────────────────────┐
│  Browser (React SPA - Vite/React 19) │
│  Deployed: Vercel                    │
│                                      │
│  ┌─────────────────┐                 │
│  │ AuthContext      │ ← supabase.js  │
│  │ (Supabase Auth)  │                │
│  └─────────────────┘                 │
│           │                          │
│  Pages: CandidatesPage, ClientsPage, │
│          JobsPage, ClientDetailPage  │
│           │                          │
│  fetch('/api/*')  ──────────────────►│
└──────────────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │  Express API (Node.js)               │
                    │  Deployed: Vercel Serverless / local │
                    │                                      │
                    │  authMiddleware → req.user           │
                    │                                      │
                    │  Controllers:                        │
                    │  - candidateController               │
                    │  - clientController                  │
                    │  - jobController                     │
                    │  - resumeController                  │
                    │  - documentController                │
                    │                                      │
                    │  Services:                           │
                    │  - aiProvider (Gemini)               │
                    │  - filterEngine                      │
                    │  - cvStorage                         │
                    │  - resumeParser (pdf-parse + OCR)    │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │  Supabase (managed cloud)            │
                    │                                      │
                    │  PostgreSQL:                         │
                    │  - candidates                        │
                    │  - candidate_associations            │
                    │  - clients                           │
                    │  - jobs                              │
                    │  - profiles                          │
                    │  - user_preferences                  │
                    │                                      │
                    │  Auth: Supabase Auth (email/password)│
                    │                                      │
                    │  Storage Buckets:                    │
                    │  - resumes (CVs)                     │
                    │  - jds (Job Descriptions)            │
                    │  - contract-pdfs (Client contracts)  │
                    └─────────────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │  Google Gemini AI                    │
                    │  - Resume field extraction           │
                    │  - Natural language → filter JSON    │
                    │  Primary + Secondary API key pool    │
                    └─────────────────────────────────────┘
```

---

## Full File Tree

```
ATS FYNDBRIDGE/
├── index.html                        # Vite HTML entry
├── vite.config.js                    # Vite config (React plugin, /api proxy)
├── package.json                      # Frontend deps (React, Vite, Supabase, Lucide)
├── eslint.config.js
├── vercel.json                       # Vercel deployment config (routes + backend function)
├── .env                              # Frontend env vars (VITE_SUPABASE_URL etc.) — NOT committed
├── .env.example                      # Template
├── README.md
├── public/                           # Static assets
├── src/                              # ── FRONTEND ──
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── context/
│   │   ├── AuthContext.jsx
│   │   ├── authStore.js
│   │   └── useAuth.js
│   ├── services/
│   │   └── supabaseClient.js
│   ├── pages/
│   │   ├── LoginPage.jsx / .css
│   │   ├── DashboardLayout.jsx / .css
│   │   ├── DashboardHome.jsx / .css
│   │   ├── CandidatesPage.jsx        ← largest file (~90 KB)
│   │   ├── ClientsPage.jsx           ← client management (~55 KB)
│   │   ├── ClientDetailPage.jsx / .css
│   │   ├── ClientJobCandidatesPage.jsx / .css
│   │   ├── JobsPage.jsx              ← mandate management (~42 KB)
│   │   ├── ProfileSettingsPage.jsx
│   │   ├── SettingsPage.jsx
│   │   └── PlaceholderPage.css
│   ├── components/
│   │   ├── Sidebar.jsx / .css
│   │   ├── Topbar.jsx / .css
│   │   ├── FyndbridgeLogo.jsx
│   │   ├── NewActionDropdown.jsx
│   │   └── TablePopover.jsx
│   └── utils/
│       ├── candidateUtils.js
│       ├── candidateStatuses.js
│       ├── candidateTableColumns.js
│       ├── mandateStatuses.js
│       ├── sectorOptions.js
│       └── storageBuckets.js
├── server/                           # ── BACKEND ──
│   ├── server.js                     # Entry point
│   ├── package.json                  # Backend deps (Express, Supabase, Gemini, Multer, etc.)
│   ├── .env                          # Backend env vars (service role key, Gemini keys) — NOT committed
│   ├── .env.example
│   ├── eng.traineddata               # Tesseract English OCR model
│   ├── scripts/
│   │   └── seed-demo.js
│   ├── src/
│   │   ├── app.js
│   │   ├── controllers/
│   │   │   ├── candidateController.js    (~48 KB, 1498 lines)
│   │   │   ├── clientController.js       (~22 KB)
│   │   │   ├── jobController.js          (~13 KB)
│   │   │   ├── resumeController.js
│   │   │   ├── documentController.js
│   │   │   ├── authController.js
│   │   │   ├── userPreferenceController.js
│   │   │   └── userProfileController.js
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js
│   │   │   └── uploadMiddleware.js
│   │   ├── routes/
│   │   │   ├── candidates.js
│   │   │   ├── clients.js
│   │   │   ├── jobs.js
│   │   │   ├── resumes.js
│   │   │   ├── documents.js
│   │   │   ├── auth.js
│   │   │   ├── ai.js
│   │   │   ├── userPreferences.js
│   │   │   └── userProfiles.js
│   │   └── services/
│   │       ├── aiProvider.js
│   │       ├── filterEngine.js
│   │       ├── cvStorage.js
│   │       ├── resumeParser.js
│   │       ├── extractorUtils.js
│   │       ├── storageBuckets.js
│   │       ├── documentStorage.js
│   │       ├── supabaseAdmin.js
│   │       └── supabaseAnon.js
│   └── supabase-*.sql               # Database migration scripts
└── docs/                            # ← YOU ARE HERE
    ├── BACKEND.md
    ├── FRONTEND.md
    ├── DATABASE.md
    └── FULL_PROJECT.md
```

---

## Core Features

### 1. Candidate Management
- **Add Candidate** via CV upload (PDF/DOC/DOCX) or manual entry
- **Resume Parsing**: pdf-parse → Tesseract OCR (fallback) → Gemini AI extraction → heuristic fallback
- **CV Deduplication**: SHA-256 file hash checked against DB before saving
- **Bulk Upload**: up to 10 resumes at once
- **AI Search**: natural language → Gemini → structured filter JSON → in-memory filter
- **Candidate Display ID**: `CA###` (gap-filling sequence)
- **Status Tracking**: per association (Interested → Screening → … → Joined/Rejected)

### 2. Client Management
- Full CRUD for client companies
- Contract document upload (stored in `contract-pdfs` bucket)
- Follow-up log (JSON array on the client row)
- Client Display ID: `CL###` (gap-filling trigger)
- Duplicate name detection before creation

### 3. Job / Mandate Management
- Full CRUD for job mandates linked to clients
- JD PDF upload (stored in `jds` bucket)
- Mandate statuses: `Ongoing`, `Scrapped`, `Completed`
- Budget ranges (e.g. `20-25 lac`)
- Multiple consultant assignment (`consultants` array)
- Job Display ID: `JB###`
- AI search with natural language filter

### 4. Association Tracking (`candidate_associations`)
- Links a candidate to a client and/or job
- Tracks status per association (not global status)
- Records current salary, expected salary, offered CTC, date of joining
- Consultant and notes per association

### 5. AI Filter Engine
- Used by both Candidates page and Jobs page
- User types natural language: e.g. `"candidates with 5+ years in Mumbai from TCS"`
- Backend converts to: `[{ field: 'experience', operator: 'greater_than_or_equal', value: 5 }, { field: 'current_location', operator: 'contains', value: 'Mumbai' }, ...]`
- Two strategies:
  - **Gemini AI**: prompt → JSON (primary)
  - **Local regex `parsePrompt()`**: fallback if AI fails or returns empty
- Filters applied in-memory on the full candidate/job list

### 6. Authentication
- Supabase email/password login
- Domain-restricted to `@fyndbridge.in` emails (enforced in frontend AuthContext)
- JWT-based session, sent as `Authorization: Bearer` header on all API calls
- Backend validates JWT via Supabase Anon client

---

## Data Flow: Add Candidate via CV Upload

```
User selects CV file
        │
        ▼
POST /api/candidates/check-cv-duplicate
  → SHA-256 hash → query DB → return { duplicate: bool }
        │
   [If duplicate] ──► Show duplicate resolution modal
   [If not] ─────►
        │
        ▼
POST /api/candidates/parse-resume
  → Save to /tmp/
  → pdf-parse (extract text)
  → [text < 100 chars?] → tesseract.js OCR
  → extractorUtils.extractFields(text)  [heuristic]
  → callAiJson(resumePrompt)            [Gemini]
  → merge results (AI priority)
  → return { ai_extracted, extracted, raw_text }
        │
        ▼
User reviews / edits parsed fields in modal
        │
        ▼
POST /api/candidates  (multipart: form fields + cv_file)
  → cvStorage.prepareUploadedCv(file)
    → hash-check → upload to 'resumes' bucket → get public URL
  → INSERT into candidates (+ cv_link, cv_file_hash, cv_storage_path)
  → INSERT into candidate_associations (status='Interested', client_id, job_id if set)
  → return { candidate, association }
        │
        ▼
Frontend adds new row to candidate table
```

---

## Data Flow: AI Natural Language Search

```
User types: "show me candidates from HDFC with 8+ years"
        │
        ▼
POST /api/candidates/ai-filter  { prompt: "..." }
  → filterEngine.buildAiFilterPrompt('candidates', prompt)
  → callAiJson(prompt, schema)  [Gemini]
  → filterEngine.validateAiFilters('candidates', aiResult, prompt)
  → normalizes values (moneyValue, dateValue, etc.)
  → returns { conditions: [...] }
        │
        ▼ [If Gemini fails]
  → filterEngine.parsePrompt('candidates', prompt)  [regex fallback]
        │
        ▼
Frontend receives filter conditions
  → filterEngine.applyFilters('candidates', allRows, filters, valueGetter)
  → filters in-memory (no DB query)
  → updates displayed table
```

---

## Deployment

### Vercel Configuration (`vercel.json`)

The project is deployed as a monorepo on Vercel:
- **Frontend**: Static Vite build served from `/`
- **Backend**: Express app served as a Vercel Serverless Function via `/api/*` routes

During local development:
- Frontend: `npm run dev` (Vite dev server, port 5173)
- Backend: `cd server && node server.js` (Express, port 4000)
- Vite proxies `/api/*` requests to `localhost:4000`

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (frontend) |
| `npm run build` | Build frontend for production |
| `npm run seed:demo` | Run `server/scripts/seed-demo.js` to populate demo data |
| `cd server && node server.js` | Start backend locally |

---

## Environment Variables

### Frontend (`.env` in project root)

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_API_BASE_URL` | Backend API base URL (optional if proxied) |

### Backend (`server/.env`)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Full admin key — **never expose to frontend** |
| `SUPABASE_ANON_KEY` | Used for JWT validation |
| `GEMINI_API_KEY_PRIMARY` | Primary Gemini API key |
| `GEMINI_API_KEY_SECONDARY` | Fallback Gemini API key |
| `GEMINI_MODEL` | Model name (e.g. `gemini-3.1-flash-lite`) |
| `FRONTEND_URL` | Frontend origin for CORS (e.g. `https://fyndbridge.vercel.app`) |
| `PORT` | Server port (default `4000`) |

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| **Supabase** as backend-as-a-service | Provides Auth, Postgres, and Storage in one service. Reduces infrastructure overhead. |
| **In-memory filtering** (no DB full-text search) | Simpler to implement, supports complex multi-field AI-generated filters without building complex SQL dynamically. Works at current data scale. Does not scale to very large datasets. |
| **Two Gemini API keys** | Free tier Gemini keys have quota limits. Having a secondary key allows failover without user-visible failures for common usage patterns. |
| **SHA-256 CV deduplication** | Prevents the same CV from being uploaded multiple times. Hash-based object naming means the same file always gets the same storage path (idempotent upload). |
| **OCR fallback (Tesseract.js)** | Some CVs are image-based PDFs. `pdf-parse` returns empty text for these; Tesseract provides a last-resort text extraction. |
| **`candidate_associations` for many-to-many** | A candidate can be tracked against multiple clients/roles. Using a junction table with status/salary per association is more expressive than embedding arrays on the candidate. |
| **Display IDs (`CA###`, `CL###`, `JB###`)** | Recruiters need short, memorable IDs for sharing/searching. UUIDs are impractical for verbal communication. |
| **Domain-restricted login** | Only `@fyndbridge.in` emails can access the app. Enforced in `AuthContext.jsx` at the session acceptance step. |

---

## Known Issues & TODOs

### Backend
- `/tmp/` storage for uploads will be ephemeral and size-limited on Vercel Serverless
- No per-route authentication enforcement (missing `req.user` doesn't return 401)
- All candidate/job data fetched in bulk then filtered in-memory — will degrade with large datasets
- No pagination on any list endpoint
- `updated_at` is not auto-updated by trigger — relies on controller to set it

### Frontend
- `CandidatesPage.jsx` is ~2054 lines and should be refactored into smaller components
- `candidateUtils.js` has a misplaced import at the bottom of the file
- No loading skeleton/shimmer UI — blank table during fetch
- No pagination on candidate/client/job tables
- `ClientsPage.jsx` uses the jobs AI filter route for its search instead of a client-specific one

### Database
- `candidates.current_company` and `candidates.current_organisation` are duplicate semantically — should be consolidated
- Denormalized `client_name` / `job_title` in `candidate_associations` can drift from actual client/job names
- No soft delete support — all deletes are permanent
- No full-text search indexes — filtering is application-level

---

## For AI Coding Assistants: Key Patterns

### Adding a new field to candidates
1. Add column to `candidates` table via SQL migration in `server/`
2. Update `candidateController.js` — add to SELECT queries, INSERT, UPDATE
3. Update `apiCandidateToUi()` in `src/utils/candidateUtils.js` — add mapping
4. Update the form in `CandidatesPage.jsx` — add input field + state
5. Update `filterEngine.js` `candidateFields` if it should be filterable

### Adding a new API route
1. Create handler function in the appropriate controller (`server/src/controllers/`)
2. Register the route in the corresponding router file (`server/src/routes/`)
3. The route is automatically available because all route files are mounted in `app.js`

### Making an authenticated API call from the frontend
```js
import { supabase } from '../services/supabaseClient'

const { data: { session } } = await supabase.auth.getSession()
const response = await fetch('/api/candidates', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`
  }
})
```

### Changing the Gemini model
Set `GEMINI_MODEL` env variable in `server/.env`. The model is read at startup in `aiProvider.js`.

### Adding a new Supabase Storage bucket
1. Create the bucket in Supabase dashboard
2. Add to `STORAGE_BUCKETS` in both `server/src/services/storageBuckets.js` and `src/utils/storageBuckets.js`
3. Add to `LEGACY_BUCKET_NAMES` if it has a legacy name

### Understanding the candidate table row shape
The `GET /api/candidates` endpoint returns rows that are **joins** of `candidates` + `candidate_associations` + `clients` + `jobs`. Each row represents one **association**, not one candidate. A candidate with 3 associations will appear 3 times. The `candidate_id` field holds the canonical candidate UUID; `id` / `association_id` holds the association UUID. This is why `apiCandidateToUi()` maps `id` to `association_id || id`.
