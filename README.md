# EDXI 2026 Colombia Timing Map

This version is prepared for static hosting on GitHub Pages and connects directly from the browser to Supabase.

## Current connection model

- Hosting: GitHub Pages
- Database: Supabase
- Frontend connection: direct calls from `sync-sheets.js`
- Key used in browser: publishable key

The app no longer depends on Google Sheets to load or save schedule data.

The schedule grid covers `07:00` through `18:00` in 30-minute blocks. Rows
stored with the previous `07:30` through `17:30` range are expanded
automatically without shifting their existing assignments.

## Concurrent editing

Schedule changes are saved incrementally by `(work_date, member_id)`. The app no
longer deletes and recreates the full year when somebody edits a cell. This lets
different team members update their own rows at the same time without overwriting
one another.

Pending schedule rows are also kept in a small browser outbox. A transient
network failure or page reload does not discard them; the app restores and
retries those rows on the next load.

Supabase must have a primary key or unique constraint on
`daily_assignments (work_date, member_id)` because incremental writes use that
pair as the `upsert` conflict target.

Two browsers editing the same member on the same date still use last-write-wins,
because all of that person's time slots for the date are stored in one database
row.

Run the concurrency regression tests with:

```powershell
npm.cmd test
```

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
