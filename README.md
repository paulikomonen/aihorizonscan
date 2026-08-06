# AI Horizon Radar — Supabase-backed collaborative version

This package contains a static AI signal radar that can be hosted on GitHub Pages or another static host.

## Files

- `index.html` — the application
- `signals.json` — the signal database read by the hosted app

## Hosting on GitHub Pages

1. Upload `index.html` and `signals.json` to the repository root.
2. Enable GitHub Pages for the repository.
3. Open the published Pages URL.

## Updating the signal database

The app is designed for a simple curated update workflow:

1. Open the hosted app.
2. Go to **Update tracker**.
3. Paste a JSON array, or an object with a `signals` array.
4. Use **Validate JSON batch** to preview count, missing titles and likely duplicates.
5. Import the JSON.
6. Import the batch while signed in as an allow-listed editor.

When Supabase dynamic signals are enabled, the import is written directly to the shared `signals` table. Dashboard, Signal Radar, Signals and Innovation implications use the same refreshed dataset, and the data remains available after browser refresh. `signals.json` remains the local/offline fallback when Supabase is not configured.

### Excel master synchronization

The Update Tracker accepts the project master `.xlsx` workbook in addition to JSON. It reads only the worksheet named `Signals` and validates the 17-column signal template before enabling synchronization. Matching Signal IDs are updated, new IDs are inserted, and active database signals missing from the workbook are archived after an explicit summary and confirmation. Other workbook sheets are ignored.

This workflow treats Excel as the editorial master and Supabase as the published website database. For each weekly or fortnightly update, upload the complete current workbook rather than a partial extract. The editor signal archive migration in `supabase/editor-signal-archive-migration.sql` must be installed before the first synchronization.

JSON imports preserve `signalId` (including the legacy `Signal ID`, `Signal Id`, `SignalID`, `signalID`, and `id` aliases). If an imported row has no ID, the Update Tracker assigns the next available `AI-###` identifier. Supabase array columns are converted back to the semicolon-separated stage format expected by the bundled Dashboard charts.

## Editorial positioning

The radar is positioned as a regularly updated foresight intelligence tool, with a typical update cycle of one to two weeks. Signals are hand-picked through hybrid scanning: AI-augmented signal detection, qualitative interpretation, structured source monitoring, quantitative patterning, foresight expert evaluation and manual curation.

## Notes

- No Python or backend server is required.
- The app can also be opened locally, using the embedded fallback signal snapshot.
- In Supabase mode, imported signals are permanent shared database records. In local fallback mode, imports remain browser-local until exported.


## Local fallback JSON import

When Supabase is not configured, JSON import writes to the local browser signal store and can be exported with the `Download signals.json` control.


## Signals list sorting

The Signals tab displays signals from newest to oldest by default, based on the database-added timestamp (`createdAt`). Static fallback records use the signal `date` when no added timestamp is available.


## Data refresh behaviour

In Supabase mode, the shared `signals` table is authoritative, including when it is empty. A successful import refreshes the common `/api/signals` query used by Dashboard, Signal Radar, Signals and Innovation implications. Later browser loads read the same records from Supabase.

In local fallback mode, the hosted app checks `signals.json` on load. If it changes in the repository, the repo file replaces stale local edits. The **Reload from repo** and download controls are only shown in this fallback mode.


## Data-loading fix in this version

The app queries a common `/api/signals` compatibility layer. It is backed by Supabase when dynamic signals are enabled and by `signals.json` otherwise, so all data views receive the same dataset.

The embedded 100-signal database remains as an offline fallback for double-click/local use.

## Editing access

Without Supabase configuration, the **Update tracker** tab and the **Archive signal** function retain the legacy project-password gate:

```text
aiscan
```

This is only a lightweight client-side gate intended to prevent accidental edits in a limited local demo. When Supabase is configured, the frontend replaces it with direct email-and-password login and verifies the account against `editor_accounts`; database row-level security remains the actual authorization boundary.

## Sharing and security notes

For a limited project audience, avoid adding confidential or sensitive material to `signals.json`. Anyone who can access the published site can technically access the signal database file directly.

Recommended precautions:

- Keep the GitHub repository private if the signal data is not meant to be public.
- Share the GitHub Pages link only with the intended project audience.
- Do not include personal data, confidential client information, unpublished research material, or restricted source notes in the signal descriptions.
- Treat the in-app password as an editing friction layer, not as real authentication.
- For stronger access control, host the app behind an authenticated service or organisational access gateway.
- Review imported JSON before committing it to the repository, especially source URLs and free-text notes.
## Brand preview assets

This version includes the high-resolution AI Horizon Radar visual logo for favicons, thumbnails and shared-link previews.

- `assets/brand/ai-horizon-radar-logo.png` — square logo / thumbnail / app icon / Open Graph image, 1254 × 1254 px.
- `site.webmanifest` — points to the same square PNG as the application icon.

The PNG file is copied into the package unchanged. It was not resized, compressed, cropped or re-exported. The HTML metadata points to this file directly; browsers and social platforms may scale the display preview, but the source file in the package remains full-resolution.

For production, some social platforms prefer absolute Open Graph image URLs. After publishing to GitHub Pages or a custom domain, the relative `og:image` and `twitter:image` paths can be changed to absolute URLs if link previews do not refresh correctly.

## Brand logo assets

The original sharp logo file is preserved unchanged at:

- `assets/brand/ai-horizon-radar-logo.png` (1254 × 1254 px)

Smaller PNG derivatives are included for faster loading in favicons, mobile app icons, web app manifests and shared-link previews:

- `assets/brand/ai-horizon-radar-logo-32.png`
- `assets/brand/ai-horizon-radar-logo-180.png`
- `assets/brand/ai-horizon-radar-logo-192.png`
- `assets/brand/ai-horizon-radar-logo-512.png`
- `assets/brand/ai-horizon-radar-logo-1200.png`

These resized versions are direct derivatives of the same logo image. The visual logo design has not been changed.

## Signal Radar MVP assessment layer

This package includes a lightweight interaction layer for the Signal Radar view.

In the radar view, users can click a signal dot and add a simple local assessment:

- Impact: Low / Medium / High
- Uncertainty: Low / Medium / High
- Recommended response: Watch / Prepare / Act
- One strategic note
- Optional "important" marker

The feature is intentionally simple and stores assessments in the visitor's browser local storage. It does not require a backend and does not change the main layout or the `signals.json` database.

Personally assessed dots are visually highlighted with a subtle yellow outline. The personal snapshot summarises how many signals this browser has assessed, how many are high-impact priorities, and how many are high-impact/high-uncertainty scenario drivers.


## GitHub Pages deployment checklist

Upload the extracted files at the repository root, preserving `assets/brand/`, `signals.json`, `site.webmanifest`, and `.nojekyll`. Do not upload the package as a nested folder. If the site shows old data, hard-refresh the page and clear local browser storage for the site.

## Collaborative workshop prototype

The repository includes an optional Supabase-backed mode for dynamic signals and anonymous, aggregated workshop ratings. It is disabled by default, so the existing GitHub Pages behaviour remains unchanged until the project configuration is added. See [`WORKSHOP_BACKEND.md`](WORKSHOP_BACKEND.md) for the database, security and deployment instructions.

When enabled, the Radar also shows a **Workshop group snapshot** based on the aggregate database function. It refreshes automatically every four seconds while the Radar tab is visible. Green dashed rings identify signals with group ratings; the yellow outline continues to identify signals assessed in the current browser. Sector headings are positioned outside the plotting circle and a deterministic spacing pass keeps dense dot clusters from visually overlapping.

Allow-listed editors can reset the active workshop's assessment round from **Update tracker**. The control requires an explicit `CLEAR` confirmation and removes ratings and notes without changing the signal database. Existing Supabase projects must run `supabase/assessment-reset-migration.sql` once before using it.

Editor access uses Supabase email-and-password authentication. Create the editor in **Authentication → Users**, then add the same lower-case email to `public.editor_accounts`. No magic-link callback URL is required.
