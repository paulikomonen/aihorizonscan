# AI Horizon Signal Tracker — GitHub-ready dynamic JSON version

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
