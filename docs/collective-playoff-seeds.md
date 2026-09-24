# Collective playoffs: data contract and remaining backend work

## Verified diagnosis

On the supplied Vercel Preview, signing in restored season 2026, the three
Wild Card games, Caleb Williams and the Eagles prediction without a code change.
The observed empty state was an unauthenticated read presented as missing data.
No defective season filter, column or join was demonstrated. The loader now
awaits the session, shows a sign-in state, and logs table-specific query errors.
This does not change RLS or grant access to other participants' protected rows.
The authenticated check verified one existing participant, not multi-account RLS.

## Existing integration

`app/admin/page.js`, `updateTeamStandingsFromEspn`, calls:
https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=0&level=3

The response inspected on 2026-09-23 has AFC/NFC parent nodes, division children
and an explicit `playoffSeed` stat in team entries. These are current standings,
not the final 2026 playoff field. Reuse this integration for a future approved
backend import; do not create another live standings feed in the collective UI.

The existing importer retains wins/losses/ties, division_name and division_rank
in `teams`. It uses ESPN divisionRank when supplied, otherwise entry index + 1.
The regular UI formats those stored division standings. No NFL tiebreak engine,
conference playoff ranking persistence or frozen season-specific seed snapshot
was found in the repository. This is a code audit, not a full live database
schema audit. ESPN's explicit playoffSeed is preferable to division rank or
array position; no tiebreak calculation is added here.

## Minimal persistence recommendation — NOT executed

Subject to schema inspection and owner approval, store `playoff_seeds` rows:
- season (integer), team_id (foreign key to teams), conference (AFC/NFC),
  seed (integer 1–7), source_team_id (ESPN identifier), captured_at, frozen_at.
- Unique (season, team_id) and (season, conference, seed).
- A backend transaction validates exactly 14 unique teams, one seed 1–7 per
  conference, explicit ESPN playoffSeed, correct season and completed regular
  season. Resolve ESPN identifiers to canonical local team names; never guess.
- Freeze once playoff qualification is official, before opening Wild Card.
  Enforce immutability of frozen rows server-side. Do not keep syncing them from
  changing standings. No SQL migration, RLS or Admin changes in this task.

Future backend adapter supplies:
`{ season, frozen: true, teams: [{ team, conference, seed }, ...] }`
to CollectiveView's `seedSnapshot`. No production source is wired until approved
persistence exists. An invalid/incomplete snapshot is rejected as a whole.

## Progression behavior

- Real Supabase games always take precedence. Even a partially imported round
  suppresses projections for that round to avoid overlaps.
- ESPN `post` plus finite unequal scores establishes a winner. Official scores,
  when present, have priority. Scores alone never imply FINAL.
- Without a valid snapshot: show known winners as provisionally qualified;
  opponents/seeds/conferences remain undetermined. No guessed byes.
- With a snapshot: #1 AFC/NFC qualify for Divisional immediately, without a
  Wild Card game, score or ESPN event. Display an unknown opponent initially.
- Once all three conference Wild Cards are final: original seeds ascending,
  first vs last and middle pair. Partial winners remain listed as qualified
  without inventing matchups. This implementation conservatively waits for all
  three results before pairing, even if a particular pairing becomes inevitable
  sooner.
- Two Divisional winners meet with the better original seed at home.
- AFC and NFC conference winners populate their Super Bowl slots independently.
- Projections are display data only: no inserts, no invented external IDs, no
  picks accepted against them, and no multiplier calculation (including byes).
- Supabase reloads every 60 seconds; ESPN polls every 30 seconds. Last successful
  ESPN scores survive transient errors. TEST-* is filtered before any fetch.

Future Admin confirmation can reuse the pure projection/validation functions,
but must independently authenticate, validate final results and persist actual
next-round games in a transaction. None of that Admin workflow is built here.
