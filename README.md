# AI Horizon Radar — GitHub-ready dynamic JSON version

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
6. Click **Download signals.json**.
7. Replace the repository's `signals.json` with the downloaded file and commit the change.

The website will read the updated `signals.json` after GitHub Pages redeploys.

## Editorial positioning

The radar is positioned as a weekly updated foresight intelligence tool. Signals are hand-picked through hybrid scanning: AI-augmented signal detection, qualitative interpretation, structured source monitoring, quantitative patterning, foresight expert evaluation and manual curation.

## Notes

- No Python or backend server is required.
- The app can also be opened locally, using the embedded fallback signal snapshot.
- Imported signals are stored in the current browser until `signals.json` is downloaded and committed to the repository.


## 2026-05-15 JSON import fix

This version fixes a browser-side storage bug that could show `LOCAL_EDITS_KEY is not defined` when importing signals. JSON import now writes to the same local signal store used by the hosted app and the `Download signals.json` control.


## Signals list sorting

The Signals tab displays signals from newest to oldest by default, based on the `date` field in `signals.json`.


## Data refresh behaviour

The hosted app checks `signals.json` on load. If the published `signals.json` changes in the GitHub repository, the app treats the repo file as authoritative and clears stale browser-local edits. If you have local edits in the Update Tracker and want to discard them manually, use **Reload from repo** on the Update Tracker page.

After importing a JSON batch, the app reloads and uses the browser-local working copy immediately across Dashboard, Signal radar, Signals and Innovation implications. Use **Download signals.json** to publish that working copy back to the GitHub repository.


## Data-loading fix in this version

The app now queries the static `/api/signals` compatibility layer instead of permanently using the embedded initial data. This means uploaded `signals.json` updates and JSON imports in the Update Tracker are reflected across Dashboard, Signal Radar, Signals and Innovation implications.

The embedded 100-signal database remains as an offline fallback for double-click/local use.

## Editing access

The **Update tracker** tab and the **Delete signal** function are protected with the project password:

```text
aiscan
```

This is a lightweight client-side gate intended to prevent accidental edits in a limited project demo. It is not strong security, because static websites expose their HTML and JavaScript to visitors.

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

Assessed dots are visually highlighted with a subtle yellow outline. A small executive snapshot summarises how many signals have been assessed, how many are high-impact priorities, and how many are high-impact/high-uncertainty scenario drivers.
