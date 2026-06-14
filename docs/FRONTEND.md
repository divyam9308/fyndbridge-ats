# Fyndbridge ATS — Frontend Documentation

## Tech Stack

| Concern | Library / Version |
|---|---|
| Bundler | Vite 8.x |
| UI Framework | React 19 |
| Routing | React Router DOM 7 |
| Icons | Lucide React 1.x |
| Database / Auth client | `@supabase/supabase-js ^2.107.0` |
| Styling | Vanilla CSS (no Tailwind) |
| Language | JavaScript (ESM, `"type": "module"`) |

---

## Directory Structure

```
src/
├── main.jsx                          # React 19 root render (createRoot)
├── App.jsx                           # BrowserRouter + AuthProvider + route tree
├── index.css                         # Global CSS reset, design tokens, utility classes
├── context/
│   ├── AuthContext.jsx               # AuthProvider, RequireAuth HOC
│   ├── authStore.js                  # React.createContext (exported AuthContext)
│   └── useAuth.js                    # useContext(AuthContext) hook
├── services/
│   └── supabaseClient.js             # Supabase client (anon key, browser-side)
├── pages/
│   ├── LoginPage.jsx                 # Email/password login form
│   ├── LoginPage.css
│   ├── DashboardLayout.jsx           # Sidebar + Topbar shell, <Outlet />
│   ├── DashboardLayout.css
│   ├── DashboardHome.jsx             # Stats overview / home dashboard
│   ├── DashboardHome.css
│   ├── CandidatesPage.jsx            # 🔴 Main candidate management (2054 lines)
│   ├── ClientsPage.jsx               # Client list + create/edit
│   ├── ClientDetailPage.jsx          # Single client view: jobs, follow-ups, associations
│   ├── ClientDetailPage.css
│   ├── ClientJobCandidatesPage.jsx   # Candidates for a specific client+job combination
│   ├── ClientJobCandidatesPage.css
│   ├── JobsPage.jsx                  # Mandate/job management
│   ├── ProfileSettingsPage.jsx       # User profile settings
│   ├── SettingsPage.jsx              # App settings stub
│   └── PlaceholderPage.css
├── components/
│   ├── Sidebar.jsx                   # Navigation sidebar
│   ├── Sidebar.css
│   ├── Topbar.jsx                    # Top bar with user info + sign-out
│   ├── Topbar.css
│   ├── FyndbridgeLogo.jsx            # SVG logo component
│   ├── NewActionDropdown.jsx         # "+ New" action dropdown button
│   └── TablePopover.jsx              # Tooltip/popover for table cells
├── utils/
│   ├── candidateUtils.js             # API→UI mapping, CV path normalization, CV open URL builder
│   ├── candidateStatuses.js          # Candidate status enum & colour mapping
│   ├── candidateTableColumns.js      # Column definitions for candidate table
│   ├── mandateStatuses.js            # Job/mandate status enum & colour mapping
│   ├── sectorOptions.js              # Sector/vertical dropdown options
│   └── storageBuckets.js             # Frontend bucket name constants (mirrors server)
├── styles/
│   └── (additional CSS files)
└── data/
    └── (static data files)
```

---

## Routing

Defined in `App.jsx`:

```
/                       → redirect to /login
/login                  → LoginPage
/dashboard              → DashboardLayout (RequireAuth)
  /dashboard            → DashboardHome (index)
  /dashboard/jobs       → JobsPage
  /dashboard/clients    → ClientsPage
  /dashboard/clients/:clientId              → ClientDetailPage
  /dashboard/clients/:clientId/jobs/:jobId/candidates → ClientJobCandidatesPage
  /dashboard/candidates → CandidatesPage
  /dashboard/cvs        → redirect to /dashboard/candidates
  /dashboard/settings   → SettingsPage
  /dashboard/profile    → ProfileSettingsPage
```

All routes under `/dashboard` are wrapped by `RequireAuth`, which redirects unauthenticated users to `/login`.

---

## Authentication (`src/context/`)

### `AuthContext.jsx` — `AuthProvider`
- Wraps the app in a React context providing `{ session, user, loading, isAuthenticated, signOut }`
- On mount: calls `supabase.auth.getSession()` to restore existing session
- Listens to `supabase.auth.onAuthStateChange` for sign-in, sign-out, token refresh events
- **Domain enforcement**: Only `@fyndbridge.in` emails are accepted. Any other email triggers `supabase.auth.signOut()` and redirects to `/login?error=domain`
- Session user stored in `window.sessionStorage` under key `fb_user` (survives page navigation within tab)

### `RequireAuth`
- HOC wrapping protected routes
- If `loading` is true → returns `null` (shows nothing while checking auth)
- If not authenticated → `<Navigate to="/login" />`

### `useAuth.js`
- Simple `useContext(AuthContext)` hook
- Used by all pages to access `user`, `isAuthenticated`, `signOut`, etc.

---

## Pages

### `LoginPage.jsx`
- Email/password form using Supabase Auth (`supabase.auth.signInWithPassword`)
- Displays domain-restriction error if `?error=domain` is in the URL
- Redirects to `/dashboard` on success

---

### `DashboardLayout.jsx`
- Shell layout: `<Sidebar />` on the left, `<Topbar />` on top, `<Outlet />` for page content
- No significant logic — purely structural

---

### `DashboardHome.jsx`
- Shows summary statistics (total candidates, clients, jobs)
- Fetches counts from the backend API on mount
- Quick-access navigation cards

---

### `CandidatesPage.jsx` ⭐ (Core Page — ~2054 lines)

The most complex page in the app. Manages the entire candidate lifecycle.

**State groups:**
- Candidate list state: `candidates`, `loading`, `aiFilters`, `searchText`
- Selected candidate state: `selectedCandidate`, `panel` mode (view/edit)
- CV upload flow state: `uploadStep`, `parsedData`, `duplicateInfo`
- Modal state: `showModal`, `modalMode` (add/edit/duplicate-resolve)
- Bulk upload state: `bulkFiles`, `bulkResults`, `showBulkModal`

**Main Features:**

#### 1. Candidate List & Table
- Fetches from `GET /api/candidates`
- Displays: CA ID, Name, Designation, Company, Experience, Location, Skills, Client, Job, Status, CV link, Consultant, Date
- Columns defined in `utils/candidateTableColumns.js`
- AI-powered search bar: natural language → `POST /api/candidates/ai-filter` → structured filter object → local `applyFilters()`

#### 2. Add Candidate Flow
**Via Resume Upload (primary flow):**
1. User drops/selects a CV file
2. `POST /api/candidates/check-cv-duplicate` — checks file hash
3. If duplicate → shows duplicate-resolution modal
4. If not duplicate → `POST /api/candidates/parse-resume` → AI/heuristic extraction
5. Parsed fields pre-fill the candidate form modal
6. User reviews/edits fields
7. `POST /api/candidates` with form data + CV file → creates candidate

**Via Manual Entry:**
- User fills in the form manually (no CV parsing)
- `POST /api/candidates` without a file

#### 3. CV Duplicate Handling
- If a duplicate CV is found, user is shown the existing candidate details
- Options: "Link to existing candidate" or "Save as new candidate anyway"

#### 4. Edit Candidate
- Opens edit form pre-populated with existing data
- `PATCH /api/candidates/:id`

#### 5. Status Update
- Inline status dropdown in the table
- `PATCH /api/candidates/:id/status`

#### 6. Bulk Resume Upload
- Upload up to 10 resumes at once
- `POST /api/resumes/bulk-parse` → parses all, returns array of extracted fields
- User reviews each parsed result and saves individually

#### 7. Candidate Detail Panel
- Slide-in side panel showing all candidate fields
- CV viewer link (opens via `GET /api/resumes/open?path=...`)

---

### `ClientsPage.jsx` (~55 KB)

Manages the client list.

**Features:**
- Client table with columns: CL ID, Name, Contact, Phone, Email, City, Status
- AI search via `POST /api/jobs/ai-filter` (mandate/job search mode)
- Create client: form + optional contract document upload → `POST /api/clients`
- Edit client: `PATCH /api/clients/:id`
- Delete client: `DELETE /api/clients/:id`
- Duplicate check before creation: `GET /api/clients/check-duplicate`
- Follow-up log: `POST /api/clients/:id/follow-ups`
- Click on client → navigates to `ClientDetailPage`

---

### `ClientDetailPage.jsx` (~36 KB)

Single client view with three sub-sections:

1. **Client Info** — editable fields (name, contact, phone, email, city, notes, billing entity, consultant, contract document)
2. **Mandates / Jobs** — jobs linked to this client; create/edit/delete jobs with JD upload
3. **Candidate Associations** — candidates associated with this client via `candidate_associations`; status update, add notes, track offered CTC and DOJ

**Key API calls:**
- `GET /api/clients/:id` — fetch client
- `GET /api/jobs?client_id=:id` — jobs for client
- `GET /api/candidates?client_id=:id` — candidates for client
- `POST /api/clients/:id/follow-ups` — add follow-up note

---

### `ClientJobCandidatesPage.jsx` (~9 KB)

Shows candidates filtered by a specific client+job combination.

- URL params: `clientId`, `jobId`
- Fetches: `GET /api/candidates?client_id=:clientId&job_id=:jobId`
- Read-only candidate list with status column
- Links back to `ClientDetailPage`

---

### `JobsPage.jsx` (~42 KB)

Mandate (job) management page.

**Features:**
- Mandate table: JB ID, Client, Role, Consultants, Team Lead, Location, Budget, Mandate Status, Vertical, Allocation Date
- AI search: natural language → `POST /api/jobs/ai-filter`
- Create mandate: linked to a client, optional JD PDF upload, consultants array field
- Edit mandate: `PATCH /api/jobs/:id`
- Delete mandate: `DELETE /api/jobs/:id`
- Mandate statuses: `Ongoing`, `Scrapped`, `Completed` (defined in `utils/mandateStatuses.js`)

---

### `ProfileSettingsPage.jsx`
- Lets user update their name
- Reads/writes to `user_profiles` table via `/api/user-profiles`

---

## Components

### `Sidebar.jsx`
Navigation links:
- Dashboard (home)
- Jobs (mandates)
- Clients
- Candidates / CVs
- Settings

Uses `NavLink` from React Router for active-state styling.

### `Topbar.jsx`
- Displays current user name from `useAuth()`
- Sign out button → calls `signOut()` from AuthContext

### `NewActionDropdown.jsx`
- "+" button that drops down with options: Add Candidate, Add Client, Add Job
- Used in `DashboardHome` for quick actions

### `TablePopover.jsx`
- Tooltip/popover component for showing truncated cell content on hover
- Used in candidate/client/job tables for long text fields

### `FyndbridgeLogo.jsx`
- SVG logo rendered inline (no external image dependency)

---

## Utilities (`src/utils/`)

### `candidateUtils.js`
**`apiCandidateToUi(row)`** — Maps the API snake_case response (which is a joined candidate + association row) to the camelCase shape used throughout the UI:
- `id` → `association_id || id` (the association UUID, used as the table row key)
- `candidateId` → `candidate_id` (the actual candidates table UUID)
- `salary` → `current_salary` (from `candidate_associations`)

**`cleanCandidateCvPath(value)`** — Strips Supabase Storage URL prefix and legacy bucket names from a CV URL/path to get a clean object path.

**`getCandidateCvOpenInfo(candidate)`** — Builds the correct URL to open a CV:
- If storage path found → returns `/api/resumes/open?path=...&candidate_id=...`
- If external URL (http/https) → returns the URL directly
- If no CV → returns `sourceType: 'missing-cv'`

**`resolveCandidateCvHref(candidate)`** — Shortcut; returns just the `finalUrl` from above.

---

### `candidateStatuses.js`
Defines all valid candidate statuses and their UI colours:
- Interested, Screening, Shortlisted, Interview Scheduled, Interviewed, Offer Extended, Offer Accepted, Offer Declined, Joined, Rejected, On Hold, Duplicate

### `mandateStatuses.js`
Valid mandate statuses: `Ongoing`, `Scrapped`, `Completed`

### `candidateTableColumns.js`
Column definitions array for the candidate table — field key, header label, width, render function.

### `sectorOptions.js`
Static array of sector/vertical options used in job creation dropdowns.

### `storageBuckets.js`
Frontend mirror of server's storage bucket constants:
```js
export const STORAGE_BUCKETS = { CV: 'resumes', JD: 'jds', CONTRACT: 'contract-pdfs' }
```

---

## Frontend API Communication

All API calls hit the backend Express server. The base URL is configured via Vite's proxy or environment variable.

**Auth header pattern** (used by all authenticated pages):
```js
const { data: { session } } = await supabase.auth.getSession()
const headers = {
  'Authorization': `Bearer ${session.access_token}`,
  'Content-Type': 'application/json'
}
fetch('/api/candidates', { headers })
```

**Multipart upload pattern** (CV/JD/contract):
```js
const formData = new FormData()
formData.append('cv_file', file)
formData.append('full_name', name)
// ... other fields
fetch('/api/candidates', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData   // no Content-Type header — browser sets boundary automatically
})
```

---

## Global AI Quota Notice

`App.jsx` listens for a custom browser event `ai-quota-reached`:
```js
window.addEventListener('ai-quota-reached', handler)
```

When the backend returns a 429 with `AI_QUOTA_REACHED`, the frontend dispatches this event and shows a dismissible banner for 10 seconds:
> "AI quota reached — search results may be limited."

---

## Vite Configuration

`vite.config.js`:
- Plugin: `@vitejs/plugin-react`
- During local dev, requests to `/api/*` are proxied to `http://localhost:4000` (the backend)

---

## Known Issues / TODOs

- `CandidatesPage.jsx` is very large (~2054 lines). It could be split into smaller components (e.g., `CandidateTable`, `CandidateForm`, `BulkUploadModal`, `DuplicateResolutionModal`).
- `candidateUtils.js` has an import at the bottom of the file (`import { STORAGE_BUCKETS } from './storageBuckets'`). This is a non-standard placement and works only because of ES module hoisting in Vite — it should be moved to the top.
- The `ClientsPage.jsx` uses job AI filter (`/api/jobs/ai-filter`) rather than a client-specific filter for its search.
- No loading skeleton / shimmer UI — tables show empty state during fetch.
- No pagination — all candidates/clients/jobs are fetched in a single request.
