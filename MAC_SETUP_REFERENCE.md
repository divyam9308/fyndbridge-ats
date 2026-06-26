# ATS FYNDBRIDGE Mac Setup Reference

This document explains what was excluded from the generated file list and what must still be handled separately when moving this project to a Mac.

## What the file list included

The earlier file structure list came from `rg --files`.

That means it included:

- normal project source files
- SQL files
- docs
- assets
- package manifests
- lockfiles
- non-ignored generated files already present in the repo folder

## What the file list did not include

These were excluded because of `.gitignore` or because `rg --files` lists files, not folders.

### Ignored by `.gitignore`

- `node_modules/`
- `dist/`
- `dist-ssr/`
- `.env`
- `.env.*`
- `server/.env`
- `server/.env.*`
- `*.local`
- `.vscode/*` except `.vscode/extensions.json`
- `.idea/`
- `.DS_Store`
- log files like `*.log`

### Not shown because they are directories, not files

- `src/`
- `server/`
- `public/`
- `supabase/`
- `docs/`
- `api/`
- `output/`
- `tmp/`

### Also not included in the file list output

- `.git/`
- untracked ignored files
- OS/editor cache files

## Files and folders you should carry over or restore separately

These matter even though they were not in the earlier text file list.

### Required

- `.git/`
  - Keeps commit history, branches, remotes, and Git state.
- root `.env` and any `.env.*` files actually used by the frontend
- `server/.env` and any `server/.env.*` files used by the backend

### Optional but useful

- `.vscode/extensions.json`
  - Already allowed by `.gitignore` if present.
- any personal notes or local setup files you intentionally keep outside ignore rules

## Files and folders you should not copy from Windows to Mac

- `node_modules/`
- `dist/`
- `dist-ssr/`
- log files
- `.DS_Store`
- editor caches

Reinstall dependencies on the Mac instead of copying Windows installs.

## Install surfaces in this repo

### Frontend

- [package.json](/C:/Users/divya/Desktop/ATS%20FYNDBRIDGE/package.json)
- [package-lock.json](/C:/Users/divya/Desktop/ATS%20FYNDBRIDGE/package-lock.json)

Install with:

```bash
npm ci
```

### Backend

- [server/package.json](/C:/Users/divya/Desktop/ATS%20FYNDBRIDGE/server/package.json)
- [server/package-lock.json](/C:/Users/divya/Desktop/ATS%20FYNDBRIDGE/server/package-lock.json)

Install with:

```bash
cd server
npm ci
```

## Repo areas that matter for reconstruction

### App source

- `src/`
- `public/`
- `index.html`
- `vite.config.js`

### Backend source

- `server/src/`
- `server/server.js`
- `api/`

### Database and Supabase

- `supabase/migrations/`
- `server/*.sql`
- `src/services/supabaseClient.js`

### Assets and generated references

- `public/assets/`
- `public/fonts/`
- `server/assets/fonts/`
- `output/pdf/`
- `tmp/pdfs/`

## Migration checklist

### Safest option

Use Git to move the repo:

```bash
git clone <repo-url>
```

Then restore env files manually and run fresh installs.

### If copying manually

Copy:

- all project files
- `.git/`
- env files

Do not copy:

- `node_modules/`
- `dist/`
- `dist-ssr/`

## Mac verification

After copying or cloning on the Mac:

```bash
npm ci
cd server && npm ci
cd ..
npm run build
```

If the app uses the backend locally, also start the server after restoring env files:

```bash
cd server
npm run dev
```

## Important note

No markdown reference can guarantee "no error comes". The main failure points during migration are usually:

- missing `.env` values
- not copying `.git/` when history/remotes are needed
- copying Windows `node_modules`
- missing local CLI tools such as Supabase CLI
- path or permission differences on macOS

This file is meant to prevent the common omissions from the earlier file list.
