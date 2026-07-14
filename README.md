# EDXI 2026 Colombia Timing Map

This version is prepared for static hosting on GitHub Pages and connects directly from the browser to Supabase.

## Current connection model

- Hosting: GitHub Pages
- Database: Supabase
- Frontend connection: direct calls from `sync-sheets.js`
- Key used in browser: publishable key

The app no longer depends on Google Sheets to load or save schedule data.

## Supabase project used

- Project URL: `https://dbzyirwwfvxpdfsukhdq.supabase.co`

The publishable key is configured directly in [index.html](C:\Users\E072168\Downloads\EDXI2026ColombiaTMAP-QAVersion-main\EDXI2026ColombiaTMAP-QAVersion-main\index.html:195).

## Files involved

- [sync-sheets.js](C:\Users\E072168\Downloads\EDXI2026ColombiaTMAP-QAVersion-main\EDXI2026ColombiaTMAP-QAVersion-main\sync-sheets.js:1)
  Loads `members`, `brands`, and `daily_assignments` directly from Supabase REST and saves the current app state back to those tables.

- [index.html](C:\Users\E072168\Downloads\EDXI2026ColombiaTMAP-QAVersion-main\EDXI2026ColombiaTMAP-QAVersion-main\index.html:190)
  Injects the Supabase URL and publishable key into the frontend.

- [supabase-github-pages-policies.sql](C:\Users\E072168\Downloads\EDXI2026ColombiaTMAP-QAVersion-main\EDXI2026ColombiaTMAP-QAVersion-main\supabase-github-pages-policies.sql:1)
  SQL script to allow direct access from a static site.

## Important limitation

Because GitHub Pages is static, there is no private backend to hold a service key.

That means the browser can only use:

- the publishable key

So your RLS policies must allow the browser role that uses that key. If you do not add compatible policies, reads and writes will fail.

## Security note

The provided SQL enables direct `anon` access so the static site can work without a login flow.

That is the simplest setup, but it also means anyone who can use the site can read and modify the data exposed by those policies.

If later you want tighter security, the next step would be:

- add Supabase Auth to the app
- change policies from `anon` to `authenticated`

## What to do next

1. Open Supabase SQL Editor.
2. Run [supabase-github-pages-policies.sql](C:\Users\E072168\Downloads\EDXI2026ColombiaTMAP-QAVersion-main\EDXI2026ColombiaTMAP-QAVersion-main\supabase-github-pages-policies.sql:1).
3. Push these code changes to GitHub.
4. Let GitHub Pages redeploy.
5. Open the site and make a small edit.
6. Verify rows in `daily_assignments` from Supabase Table Editor.
