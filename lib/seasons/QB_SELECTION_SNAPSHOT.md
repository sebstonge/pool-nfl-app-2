# Regular QB selection history

Prepared from main ea964b9. The operator has confirmed successful manual
Production installation and historical backfill. Application delivery performs
no Supabase operation and must not replay either SQL script.

## Minimal schema

`202610190001_regular_qb_selection_snapshot.sql` adds three nullable TEXT columns to
`qb_picks`, with no defaults: `selected_qb_name`, `selected_espn_athlete_id`,
`selected_team`. Existing season/week/user/qb identifiers are reused. The trio is
all NULL or all nonblank. The exceptional correction adds one protected audit
table; no qbs privileges are changed.

The INSERT trigger reads the selected catalog row FOR SHARE and replaces client
metadata with its current server values. That catalog is evidence for a NEW
selection only. Later catalog changes cannot modify the saved trio. The UPDATE
trigger also protects the choice's qb_id, season, week and user. Existing snapshot
values cannot be overwritten directly, including by service_role/postgres. An old NULL
trio can be completed exactly once by postgres/service_role with explicit,
separately reviewed evidence; UPDATE never reads qbs. Existing lifecycle and
maintenance guards still apply. No backfill is included in the migration.

A filled snapshot has one explicit exceptional correction path:
`correct_regular_qb_selection_snapshot(uuid,uuid,jsonb,jsonb,text)`. This
postgres-owned SECURITY DEFINER RPC has an empty search_path and EXECUTE only
for its owner and service_role. It requires a real Admin actor, a reason, an
exact full-row `to_jsonb(qb_picks)` expected value and exactly three new nonblank
selected_* strings. It locks qb_picks before settings, preserves lifecycle and
maintenance guards, and rejects closed/historical seasons. It cannot change
qb_id, user, season, week, creation time, official results or scores. There is no
browser correction workflow, selection reset or delete/reinsert.

`regular_qb_snapshot_corrections` records the before row, after trio, actor,
reason, transaction and application time. RLS is enabled with no policies;
anon/authenticated have no privileges, service_role SELECT only. A receipt can
authorize one exact UPDATE only under postgres in the same transaction; the
trigger consumes it and verifies the full before/after row. No caller-set GUC
can bypass immutability. Correction and receipt roll back together. A retry
returns its original receipt only while the current row still matches that
exact correction. Ordinary UPDATE remains refused. A prior final publication
becomes stale naturally through its source snapshot, without recalculating or
deleting ratings/scores.

The new migration replaces `publish_regular_final` only to validate selected
identity/team and passer selection against these snapshots. Its existing scoring,
transactional validation and permissions remain intact. Installed migrations are
not edited.

## Official result and replacement

Keep `qb_ratings.actual_qb_name`, `actual_espn_athlete_id`, `passer_rating` and the
existing season/qb_id/week identity. A duplicate `replacement_used` boolean is
unnecessary: with a complete selected snapshot and a valid official rating, a
different actual athlete ID proves replacement for that occurrence. The catalog
is never consulted for this comparison. ESPN LIVE remains temporary display data,
never historical replacement evidence. Zero remains a genuine stored rating.

Admin ESPN updates and final publication select the passer from the frozen
identity/team, using the existing selected-passer/fallback rule. Required legacy
snapshots must be reviewed first: ordinary Admin rating refresh skips those
occurrences without overwriting recorded ratings; final publication refuses them
explicitly instead of recertifying guessed history.

## Existing 2026 history

Installation changes no pick, rating, score, participant, catalog, phase or week.
Old rows retain NULL snapshots. Views show the recorded actual name/athlete/rating
when known, without a replacement badge. Missing identity is shown as unknown,
not borrowed from today's qbs. Existing images/cards/layout/interactions remain.
An ambiguous legacy choice keeps conservative consumption of its referenced row
until reviewed; this is not a claim that the catalog identity is historical.
With a verified snapshot, availability follows the athlete identity: a normal or
pending selected QB is consumed; an automatic replacement consumes neither QB,
exactly as before. A repurposed catalog row does not consume the new athlete on
behalf of the old one.

## Completed 2026 recovery

The operator approved and manually backfilled all 78 selections from weeks 1–6:
74 NORMAL, 4 REMPLACEMENT, no incomplete or ambiguous occurrence. Replacements:
Darnold → Lock and Tagovailoa → Rush in week 2; Hurts → McKee and
Jackson → Huntley in week 6. Hurts weeks 1–3 and Purdy week 6 remain normal.
Only selected_* was filled; existing official identities, ratings and scores
were preserved, including the final week 6 results. No further Production SQL
or correction RPC test is requested or required for application delivery.

### Historical recovery protocol (already completed; do not rerun)

First run only `supabase/audits/regular_qb_history_2026.sql` in SQL Editor and
return its output. It runs before or after the additive migration: optional
snapshot fields are read through to_jsonb, so an absent column does not break it.
All operations are SELECTs with built-in read-only functions.

The inventory reports current catalog identity as CONTEXT, not proof, along with
choices, official actual results, timestamps, weekly scores and any season-level
publication copy. A publication copied the catalog at final publication, not at
the choice: it is not automatically valid selection evidence. Scores and ESPN
passing rows identify performance, not the initial identity attached to qb_id.

Classifications:
- CERTAIN — NORMAL: verified selected snapshot equals the recorded actual ID.
- CERTAIN — REMPLACEMENT: verified selected snapshot differs from that ID.
- AMBIGU: initial identity or official result cannot be established. Leave NULL;
  never use current qbs as automatic backfill. An unplayed week may simply be pending.

For each known manual change, request the exact qbs UUID, previous and new
name/ESPN ID/team, the change date/time and timezone (or a bounded interval), and
any intermediate changes/returns. Confirm any direct changes to qb_picks or
qb_ratings as well. Use backups/exports or the operator's confirmed time ranges
to assign a specific identity to each selection timestamp. Anything overlapping
an uncertain change boundary stays ambiguous. Preserve the evidence and exact
pick IDs in the later reviewed recovery plan; do not infer identity from matching
ratings or majority usage. No recovery script is executed before that review. The approved 2026 plan and
non-executed explicit backfill now reside in the task outputs, separate from this migration.

## Deployment prerequisite

The additive migration was manually installed before application deployment;
the operator confirmed its audit and successful 78-row backfill. Old clients can
still INSERT their existing user/week/qb_id payload: the database fills the
snapshot. Deploy the application commit without replaying the installed
migration or the completed backfill. No lifecycle/scoring operation is part of
this delivery. SQL validation used disposable local PostgreSQL only.

## Exact local file manifest

- `app/admin/page.js`
- `app/analytics/RegularPage.js`
- `app/matchs/RegularPage.js`
- `app/qb-ratings/RegularPage.js`
- `app/tous-les-choix/RegularPage.js`
- `lib/regular-publication/fixtures.mjs`
- `lib/regular-publication/prepare.mjs`
- `lib/regular-publication/prepare.test.mjs`
- `lib/seasons/QB_SELECTION_SNAPSHOT.md`
- `lib/seasons/historyDetails.test.mjs`
- `lib/seasons/qbHistory.mjs`
- `lib/seasons/qbSnapshot.mjs`
- `lib/seasons/qbSnapshot.test.mjs`
- `lib/seasons/qbSnapshotAdmin.test.mjs`
- `lib/seasons/qbSnapshotViews.test.mjs`
- `supabase/audits/regular_qb_history_2026.sql`
- `supabase/migrations/202610190001_regular_qb_selection_snapshot.sql`
- `supabase/tests/regular_final_publication.test.mjs`
- `supabase/tests/regular_qb_inventory.test.mjs`
- `supabase/tests/regular_qb_selection_snapshot.test.mjs`

## Local SQL validation completed

The Purdy S6 result has been refreshed from the user’s read-only Production
export: rating 111.9, base 2, multiplier 1.119, final 2.238. The approved plan
contains 78 selections: 74 normal, 4 replacements, no incomplete/ambiguous
identity. Its separate backfill updates only selected_* with stale-state guards.

The exceptional correction RPC and the exact 78-row backfill have now passed
real SQL validation in disposable in-memory PostgreSQL: 56 reported tests,
53 assertions/scenarios plus 3 parent envelopes, zero failures or skips. This
includes effective ACL/RLS, legacy INSERT capture, all-three-field correction,
stale/consumed receipt rejection, failure rollback, legacy completion and
unchanged ratings/scores/standings. No functional SQL correction was needed.
No Production migration/backfill was performed by the local SQL validation.
