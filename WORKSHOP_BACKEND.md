# Collaborative workshop backend

The site retains its existing local-only behaviour until `config.js` contains a Supabase URL and publishable key. The frontend can remain on GitHub Pages or another static host; shared signals and ratings live in Supabase.

## Set-up

1. Create a Supabase project in an appropriate EU region.
2. In **Authentication → Providers**, enable anonymous sign-ins. For a public prototype, also configure CAPTCHA or Turnstile and review the anonymous-sign-in rate limits.
3. Run `supabase/schema.sql` in the SQL editor.
4. Run `node scripts/generate-supabase-seed.mjs`, then run the generated `supabase/seed.sql` in the SQL editor.
5. Copy the project URL and publishable key into `config.js`; enable both feature flags.
6. In **Authentication → Users**, create the editor user with an email address and strong password. Ensure the user is confirmed so password sign-in is permitted.
7. Allow-list the same lower-case email in the SQL editor, for example `insert into public.editor_accounts(email) values ('editor@example.org') on conflict (email) do nothing;`.
8. Open the radar with a workshop parameter, for example `?workshop=prototype#/radar`.

For a project that was created with an earlier version of `schema.sql`, run `supabase/assessment-reset-migration.sql` once before deploying the assessment-clear control. The migration preserves current ratings and adds workshop assessment-round versioning.

The browser key is intentionally public. Never place a Supabase service-role key in `config.js` or any GitHub repository.

## Behaviour

- Participants are signed in anonymously without collecting names, email addresses or other profile data.
- A browser has one editable rating per workshop and signal.
- Raw rating rows are only readable by the participant who created them.
- The Radar reads group aggregates through `get_workshop_aggregates`; participant IDs and notes are not exposed.
- Group totals, priorities and the selected signal's mean ratings refresh every four seconds while the Radar is visible. This uses the aggregate RPC rather than exposing the raw ratings table through Realtime.
- A yellow dot outline means "rated in this browser". A green dashed ring means "has workshop group ratings"; a dot may have both.
- Anonymous users cannot modify signals or workshops.
- Allow-listed permanent users manage signals and workshops through direct Supabase email-and-password login. Sign-in does not use email links, callback pages or hash-router redirects.
- The Update Tracker displays the signed-in editor and provides a sign-out button. Its browser unlock marker is removed whenever the Supabase session is missing or signed out.
- Allow-listed editors can clear all assessments for the active workshop from **Update tracker**. The destructive action requires typing `CLEAR`, deletes shared ratings and notes, and advances the workshop's assessment-round version.
- If the database is unavailable or unconfigured, signals and assessments continue to work locally as before.

## Workshop lifecycle

Create a workshop by inserting a unique `slug`, a title and status. Use `draft` while preparing, `open` while collecting ratings and `closed` to stop new ratings while retaining aggregate access. Optional opening and closing timestamps can narrow the participation window.

## Privacy and limitations

The prototype stores an internal anonymous authentication UUID, timestamps, ratings and optional notes. It does not intentionally collect participant names or email addresses. Hosting and authentication services may still process technical logs such as IP addresses, so the deployment needs an appropriate privacy notice and VTT review before use with external participants.

Anonymous browser identity is workshop-grade duplication control, not verified voting: clearing browser storage or switching device creates another identity. Aggregated results should therefore be interpreted as facilitated workshop input rather than a statistically controlled survey.

## Clearing a workshop assessment round

The clear action applies to the workshop selected by the `?workshop=` URL parameter, or to `defaultWorkshopSlug` when the parameter is absent. It does not affect signals or other workshops. Connected Radar browsers detect the new assessment-round version on their next refresh and discard old local assessments; returning offline browsers do the same when they reconnect. Ratings submitted by a stale page using the previous version are rejected by row-level security.
