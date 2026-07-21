# Collaborative workshop backend

The site retains its existing local-only behaviour until `config.js` contains a Supabase URL and publishable key. The frontend can remain on GitHub Pages or another static host; shared signals and ratings live in Supabase.

## Set-up

1. Create a Supabase project in an appropriate EU region.
2. In **Authentication → Providers**, enable anonymous sign-ins. For a public prototype, also configure CAPTCHA or Turnstile and review the anonymous-sign-in rate limits.
3. Run `supabase/schema.sql` in the SQL editor.
4. Run `node scripts/generate-supabase-seed.mjs`, then run the generated `supabase/seed.sql` in the SQL editor.
5. Copy the project URL and publishable key into `config.js`; enable both feature flags.
6. Allow-list editors in the SQL editor, for example `insert into public.editor_accounts(email) values ('editor@example.org');`.
7. Open the radar with a workshop parameter, for example `?workshop=prototype#/radar`.

The browser key is intentionally public. Never place a Supabase service-role key in `config.js` or any GitHub repository.

## Behaviour

- Participants are signed in anonymously without collecting names, email addresses or other profile data.
- A browser has one editable rating per workshop and signal.
- Raw rating rows are only readable by the participant who created them.
- The Radar reads group aggregates through `get_workshop_aggregates`; participant IDs and notes are not exposed.
- Anonymous users cannot modify signals or workshops.
- Allow-listed permanent users may manage signals and workshops through passwordless email login. The legacy `aiscan` browser gate is not database security.
- If the database is unavailable or unconfigured, signals and assessments continue to work locally as before.

## Workshop lifecycle

Create a workshop by inserting a unique `slug`, a title and status. Use `draft` while preparing, `open` while collecting ratings and `closed` to stop new ratings while retaining aggregate access. Optional opening and closing timestamps can narrow the participation window.

## Privacy and limitations

The prototype stores an internal anonymous authentication UUID, timestamps, ratings and optional notes. It does not intentionally collect participant names or email addresses. Hosting and authentication services may still process technical logs such as IP addresses, so the deployment needs an appropriate privacy notice and VTT review before use with external participants.

Anonymous browser identity is workshop-grade duplication control, not verified voting: clearing browser storage or switching device creates another identity. Aggregated results should therefore be interpreted as facilitated workshop input rather than a statistically controlled survey.
