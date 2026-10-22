# Regular selection order

`selectionOrder.mjs` is the shared rule for Mes choix, turn notifications and
the existing reminder reader. All loaders receive the season-pinned
`regularClient`, whose users carry `season_participants.initial_order`.

- Week 1 retains that explicit initial order.
- Week N sorts the stored `final_score` of N−1 ascending; missing scores follow
  real scores, including a genuine zero.
- A tie uses cumulative stored `final_score` through N−1 ascending (the lower
  general standing chooses first). Decimal sums are compared exactly without
  changing or rounding any persisted score.
- A complete tie keeps the relative order from N−1. Existing QB submission
  timestamps provide historical order; otherwise it is reconstructed from prior
  weeks, ending with initial order and stable user ID when history cannot decide.

Current submissions are removed only after the complete order is calculated.
Mes choix re-reads the shared order and current QB picks immediately before
reserving a new QB; a cached displayed turn does not authorize that submission.
This is application validation; existing RLS/DB permissions are unchanged.

Historical selection-duration statistics use observed predecessors when a
completed week's timestamps prove them. Incomplete histories retain calculated
positions rather than promoting a later known submission to first place.

No schema migration, order persistence, score/ranking rewrite, snapshot change,
Playoffs rule, reminder activation or Production operation is required.
