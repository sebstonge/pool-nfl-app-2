import {ROUNDS} from '../playoff-tree/treeData.mjs';

// No processed Playoffs result store is currently implemented in this repository.
// This is the sole integration point for the future validated-result loader.
// Do not substitute selections, ESPN data, game scores or round status here.
// See PROCESSED_RESULTS.md before connecting a result source.
export function processedPlayoffResults() {
  return {
    qbRows: [],
    progression: {weeks: ROUNDS.map(round=>round.key), rows: []},
  };
}
