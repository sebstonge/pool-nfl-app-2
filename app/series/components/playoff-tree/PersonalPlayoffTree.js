'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../../lib/supabase';
import PlayoffTree from './PlayoffTree';
import { loadPersonalTree } from './treeData.mjs';

export default function PersonalPlayoffTree({ userId, currentRound, teams, refreshKey }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const season = currentRound?.season;
  const roundId = currentRound?.id;
  const identity = `${userId}:${season}:${roundId}`;

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(false);
    if (!userId || !roundId || season == null) return;
    loadPersonalTree(supabase, { userId, season, roundId }).then(data => {
      if (!cancelled) setResult({ ...data, identity, refreshKey });
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [userId, season, roundId, identity, refreshKey, attempt]);

  // Failure is never interpreted as a complete submission or an empty future round.
  if (error) return <p role="status">Impossible de vérifier les données de l’arbre.{' '}
    <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button>
  </p>;
  if (!result?.complete || result.identity !== identity || result.refreshKey !== refreshKey) return null;
  return <PlayoffTree rounds={result.rounds} teams={teams} currentRoundKey={currentRound.round_key} />;
}
