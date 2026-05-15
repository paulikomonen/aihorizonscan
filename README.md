# AI Horizon Signal Tracker — GitHub Pages version

This version is designed for online hosting as a static GitHub Pages site.

## Files

- `index.html` — the website/app.
- `signals.json` — the signal database read by the hosted app.

## How to publish on GitHub Pages

1. Copy `index.html` and `signals.json` to the root of your GitHub repository.
2. In GitHub, enable Pages for the repository.
3. Open the GitHub Pages URL.

## How to update the online signal database

The hosted app reads `signals.json` from the same folder as `index.html`.

To update the online database:

1. Go to **Update Tracker** in the app.
2. Import a JSON batch.
3. Click **Download signals.json**.
4. Replace the repository's existing `signals.json` with the downloaded file.
5. Commit/push the change.

After GitHub Pages redeploys, the public website will show the updated database.

## Notes

- The app also contains an embedded fallback database, so the HTML can still open locally.
- Browser-local edits are stored in localStorage for the current browser.
- The floating export/download controls are shown only on the **Update Tracker** page.
