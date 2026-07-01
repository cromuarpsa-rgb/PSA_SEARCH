# PSA Search System

A search tool for the Philippine Statistics Authority's PSOC (occupation),
PSIC (industry), and HGC (highest grade completed) classification records.
Works two ways from the **same code**:

- **GitHub Pages** — a static site, no server required.
- **Local** — `python app.py`, which serves the same files plus writes an
  activity log to `logs/activity.log`.

## Deploy to GitHub Pages (your repo)

1. Push this repo's contents to `cromuarpsa-rgb/PSA_SEARCH` (root of the
   `main` branch — `index.html` must sit at the repo root, not inside a
   subfolder).
2. On GitHub: **Settings → Pages → Build and deployment → Source:
   Deploy from a branch → Branch: `main` / `root`** → Save.
3. Your site goes live at:
   `https://cromuarpsa-rgb.github.io/PSA_SEARCH/`
4. Sign in with `admin` / `admin123`, then create/rotate accounts from the
   **Admin** menu (top right) — see the security note below.

```bash
git clone https://github.com/cromuarpsa-rgb/PSA_SEARCH.git
cd PSA_SEARCH
# copy these files into the repo root, replacing the old ones
git add -A
git commit -m "Rebuild: redesigned PSA Search System"
git push
```

## Run locally

1. Install Python 3.9+ (no other dependencies needed — everything is
   standard library).
2. Double-click `run.bat` (Windows) or run `python app.py`.
3. Open `http://127.0.0.1:8000`.

Local mode additionally logs logins, searches, and errors to
`logs/activity.log`, and re-exports `data/psa-data.json` automatically if
the `.xlsx` source in `data/` is newer than the last export.

## Features

- Instant, debounced keyword search across all sheets or one sheet at a time
- Click any column header to sort; click a row to see the full record
- Pagination (25/50/100/250 rows per page) and CSV export of the filtered
  results — not just the current page
- Search-term highlighting, and PSOC/PSIC/HGC codes rendered as distinct
  "index chips" so codes and labels are easy to tell apart
- Light/dark theme toggle (remembered per browser)
- Responsive layout, down to phone widths, with visible keyboard focus
- `/` focuses search, `Esc` closes dialogs
- Admin menu: create/remove browser-only local accounts
- Local server (optional): activity log for login/search/logout/error events

## Refreshing the data

The workbook lives at `data/032026_Sorted PSOC PSIC.xlsx`. To update it:

1. Replace that file with the new workbook (keep the `.xlsx` extension).
2. Run `python scripts/export_workbook.py` to regenerate
   `data/psa-data.json`.
3. Commit both files and push — GitHub Pages picks up the new data
   immediately; the local server also re-exports automatically on startup.

`scripts/export_workbook.py` parses the `.xlsx` XML directly (no pandas/
openpyxl dependency), strips the spurious trailing `.0` Excel adds to
whole-number codes, drops fully-empty columns, and attaches a friendly
display label per column (derived from the source column code, e.g.
`C13_OCCUP` → "Occupation (C13)").

## Accounts and security — please read

This is a lightweight **local-access gate**, not a hardened identity
system, and that matters more once it's on a public GitHub Pages URL:

- The built-in `admin` account and any accounts created from the Admin
  menu are checked entirely in the browser, and extra accounts are stored
  in that browser's `localStorage` (SHA-256-hashed, not plaintext, but
  still visible to anyone with browser dev tools access to that machine).
- Anyone who can reach the page can view its client-side source, including
  the hashed default password. **Change the default password** (via the
  Admin menu) if this deployment will be reachable by people you don't
  trust with the data.
- Do not put anything more sensitive than these public classification
  tables behind this login — treat it as a "did you mean to be here"
  gate, not a security boundary.
- If your data needs real access control, this app would need a real
  backend with server-verified sessions (the Local run mode above is a
  step in that direction, but still isn't hardened for the public
  internet).

## Project layout

```
index.html, app.js, styles.css   → the site (works on GitHub Pages as-is)
data/psa-data.json               → generated search data (commit this)
data/*.xlsx                      → source workbook
scripts/export_workbook.py       → regenerates psa-data.json from the xlsx
logo/                            → PSA branding
app.py                           → optional local server + activity log
run.bat                          → Windows launcher
tests/                           → export sanity checks
logs/                            → local activity log (gitignored)
```

## Developer

Claverson Romuar
Registration Kit Operator (National ID)
