# Regular ties and Admin robustness

## Scope and installation

The single migration is `supabase/migrations/20261025164727_regular_ties_admin_robustness.sql`.
It is for **manual review and SQL Editor installation**, before deploying this application version.
It has not been installed remotely by this change. Do not replay earlier migrations.
No cron, reminder switch, playoff rule or QB selection snapshot changes are included.

Installation adds nullable FINAL evidence to `games`, ranking baselines/version state,
immutable queue payloads and attempt reservations, and the privileged regular RPCs.
Existing scores, picks, ratings, selection clocks, queue rows and lifecycle values are not rewritten.
Only the new baseline table is populated from already stored weekly scores; this produces no notification.
New ordinary picks require a positive spread. Existing zero-spread picks remain readable and unchanged.

## Final ties

`regularResults.mjs` distinguishes pending, final tie and final winner. Equal numbers alone are
not final evidence. A confirmed tie gives either valid side one base point, never an exact-spread bonus.
Normal wins, exact spreads, QB numeric-zero behavior and three-decimal arithmetic are preserved.
The SQL final publisher retains its existing source, final-ESPN and QB snapshot protections.
`regular_round_score(float8)` preserves JavaScript `toFixed(3)` behavior, including binary half cases.

Legacy rows are not blanket-labelled FINAL during migration. The regular views can verify stored
scores against a season/week ESPN scoreboard in memory, with exact event, team and score matching.
Failure or mismatch keeps saved choices/scores visible but their final scoring unconfirmed.
This read does not backfill a row or silently change an old weekly score. A historical tied weekly
score calculated with the former rule requires an authorized recalculation before the weekly
summary's existing consistency proof can certify it; this migration does not perform that action.

## Publication and ranking delivery

`regular_week_ranking_state` reads a season/week source snapshot.
`publish_regular_week` locks and revalidates that snapshot, independently recomputes scores,
and atomically saves the scores, ranking version and any per-user queue events.
The fingerprint contains published user scores and ordinal ranks, not raw NFL score changes,
base points, multiplier representations, update timestamps or an arbitrary request ID.
An unchanged result preserves its version; A → B → A creates successive versions.
Ranks mirror `rankWeeklyScores` exactly: score descending, stable input order for equal
scores, then ordinal positions. SQL captures the same whole-season `ORDER BY week ASC`
source query as the rankings page; it does not add UUID, QB, cumulative-score or initial-order
tie-breaks. Sorting the resulting JSON by user ID is serialization only, never a rank rule.
The existing source query does not define a secondary database order within a week; this
change deliberately preserves that behavior rather than inventing a new sporting rule.
Unchanged score upserts do not rewrite rows, avoiding artificial input-order changes on reruns.

Event identity is season/week/version/user. The payload is frozen when queued, so a delayed
notification describes that version rather than whatever ranking happens to exist when it sends.
Every successful Admin publication reconciles pending events, even on an unchanged rerun.
`/api/push/rankings-updated` is a recovery/delivery endpoint; it does not invent another version.

Both immediate and scheduled ranking delivery use `claim_regular_ranking` before transport.
Only the winning atomic reservation can send. The attempt is never reset, including after an
unknown provider result or failed completion-log write. This is at most one attempt per user/version
(with the existing device fanout), **not exactly-once delivery**. A crash after reservation can miss
a delivery; automatic retries after that point would risk duplicates. Telemetry remains fail-open
observability and is not used as the lock. Other notification types and reminders are unchanged.

## Admin outcomes and next week

The existing card retains counts and displays success, partial or error. Sources that are normally
pending do not count as failures. Missing expected final data and failed notification attempts are
reported; data already written is not presented as an all-green complete refresh.

The existing next-week confirmation and button call one server operation. `advance_regular_week`
validates the verified Admin, active season/week/revision, phase, pause, finalization and target
calendar. The opening clock INSERT and settings UPDATE are one transaction. A stale retry cannot
advance again or overwrite the original clock. Existing settings triggers increment the revision.
The first-player notification happens only after commit and cannot undo the advancement.
A subsequent display-refresh failure explicitly confirms the committed week.

## Local verification

Tests use mocked HTTP/clients and a disposable PGlite database with synthetic fixtures only.
Set `PGLITE_MODULE` to an installed PGlite entry point to include the SQL suites.
Run the targeted regular-result, regular-admin, notification and new SQL tests, then the full suite,
`npm run build`, and `git diff --check`. No verification requires a live Supabase project.

## Files in this change

Created or modified in this branch; paths below are the complete local manifest.

- Created: [app/admin/components/AdminRegularHandlers.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/admin/components/AdminRegularHandlers.test.mjs)
- Modified: [app/admin/components/FullUpdateStatus.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/admin/components/FullUpdateStatus.js)
- Modified: [app/admin/components/FullUpdateStatus.module.css](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/admin/components/FullUpdateStatus.module.css)
- Modified: [app/admin/components/FullUpdateStatus.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/admin/components/FullUpdateStatus.test.mjs)
- Modified: [app/admin/page.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/admin/page.js)
- Modified: [app/analytics/RegularPage.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/analytics/RegularPage.js)
- Created: [app/analytics/regularTies.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/analytics/regularTies.test.mjs)
- Created: [app/api/admin/regular-next-week/route.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/api/admin/regular-next-week/route.js)
- Created: [app/api/admin/regular-week-results/route.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/api/admin/regular-week-results/route.js)
- Modified: [app/api/push/rankings-updated/route.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/api/push/rankings-updated/route.js)
- Modified: [app/api/push/scheduled/route.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/api/push/scheduled/route.js)
- Modified: [app/matchs/RegularPage.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/matchs/RegularPage.js)
- Created: [app/matchs/regularTies.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/matchs/regularTies.test.mjs)
- Modified: [app/tous-les-choix/RegularPage.js](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/app/tous-les-choix/RegularPage.js)
- Created: [docs/regular-ties-admin-robustness.md](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/docs/regular-ties-admin-robustness.md)
- Created: [lib/notifications/rankingDelivery.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/notifications/rankingDelivery.mjs)
- Created: [lib/notifications/rankingDelivery.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/notifications/rankingDelivery.test.mjs)
- Modified: [lib/notifications/regularOrderConsumers.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/notifications/regularOrderConsumers.test.mjs)
- Created: [lib/regular-admin/operations.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/regular-admin/operations.mjs)
- Created: [lib/regular-admin/operations.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/regular-admin/operations.test.mjs)
- Created: [lib/regular-admin/routes.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/regular-admin/routes.test.mjs)
- Modified: [lib/regular-publication/prepare.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/regular-publication/prepare.mjs)
- Modified: [lib/regular-publication/prepare.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/regular-publication/prepare.test.mjs)
- Modified: [lib/seasons/qbSnapshotAdmin.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/seasons/qbSnapshotAdmin.test.mjs)
- Created: [lib/seasons/regularResultEvidence.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/seasons/regularResultEvidence.mjs)
- Created: [lib/seasons/regularResultEvidence.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/seasons/regularResultEvidence.test.mjs)
- Created: [lib/seasons/regularResults.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/seasons/regularResults.mjs)
- Created: [lib/seasons/regularResults.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/seasons/regularResults.test.mjs)
- Modified: [lib/weekly-summary/data.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/weekly-summary/data.mjs)
- Modified: [lib/weekly-summary/data.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/weekly-summary/data.test.mjs)
- Modified: [lib/weekly-summary/operations.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/weekly-summary/operations.mjs)
- Modified: [lib/weekly-summary/operations.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/weekly-summary/operations.test.mjs)
- Modified: [lib/weekly-summary/proof.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/weekly-summary/proof.mjs)
- Modified: [lib/weekly-summary/proof.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/lib/weekly-summary/proof.test.mjs)
- Created: [supabase/migrations/20261025164727_regular_ties_admin_robustness.sql](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/supabase/migrations/20261025164727_regular_ties_admin_robustness.sql)
- Created: [supabase/tests/regular_ties_admin_robustness.test.mjs](/Users/sebastienst-onge/Documents/Codex/2026-09-22/prior-conversation-with-codex-conversation-role/work/pool-nfl-app-2/supabase/tests/regular_ties_admin_robustness.test.mjs)
