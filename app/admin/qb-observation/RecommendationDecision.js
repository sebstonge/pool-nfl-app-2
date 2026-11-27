import { useRef, useState } from 'react';
import { manualQbDecision } from '../../../lib/qb-observation/manualDecision.mjs';
import styles from './journal.module.css';

export default function RecommendationDecision({ recommendation, menu, now, onRequest, onRefresh }) {
  const [selection, setSelection] = useState(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const decision = manualQbDecision(recommendation, menu, now);
  const currentName = recommendation.currentQb?.name ?? 'QB non identifié';
  const potential = recommendation.potentialQb;
  const busy = Boolean(pending);
  const disabled = !decision || busy || stale;

  function choose(next) {
    setSelection(next);
    setError(null);
  }

  function editName(event) {
    setQuery(event.target.value);
    setSelection(null);
    setMatches([]);
    setError(null);
  }

  async function request(operation, params, accept) {
    if (inFlight.current || stale) return;
    const current = manualQbDecision(recommendation, menu);
    if (!current) {
      setStale(true);
      return;
    }
    inFlight.current = true;
    setPending(operation);
    setError(null);
    try {
      const result = await onRequest({ ...current, ...params, operation });
      if (!result.ok) {
        if (result.code === 'stale' || result.status === 423) setStale(true);
        setError(result.error || 'Vérification indisponible. Réessaie.');
        return;
      }
      accept(result.data);
    } catch {
      setError('Service indisponible. Réessaie.');
    } finally {
      setPending(null);
      inFlight.current = false;
    }
  }

  function lookup(event) {
    event.preventDefault();
    if (disabled || query.trim().length < 2) return;
    setMatches([]);
    setSelection(null);
    request('lookup', { name: query.trim() }, data => {
      setMatches(data.matches);
      if (data.matches.length === 1) choose({ kind: 'other', athlete: data.matches[0] });
      if (data.matches.length === 0) setError('Aucun QB ESPN vérifié pour cette équipe.');
    });
  }

  function confirm() {
    if (disabled || !selection) return;
    const { kind, athlete } = selection;
    request('confirm', {
      selection: kind,
      confirmed: true,
      ...(athlete ? { name: athlete.name, athleteId: athlete.id } : {}),
    }, data => {
      onRefresh(data.outcome === 'maintained' ? `${currentName} est maintenu.`
        : `${athlete?.name ?? currentName} est confirmé comme titulaire.`);
    });
  }

  return (
    <div className={styles.decision}>
      <div className={styles.identityTiles}>
        <button type="button" className={styles.identityTile} disabled={disabled}
          aria-pressed={selection?.kind === 'current'} onClick={() => choose({ kind: 'current' })}>
          <span className={styles.note}>Titulaire actuel</span>
          <strong>{currentName}</strong>
          <span className={styles.note}>{recommendation.currentStatus === 'unavailable' ? 'Absence signalée' : 'Incertain'}</span>
        </button>
        {potential && <button type="button" className={styles.identityTile} disabled={disabled}
          aria-pressed={selection?.kind === 'suggested'} onClick={() => choose({ kind: 'suggested', athlete: potential })}>
          <span className={styles.note}>Remplaçant potentiel</span>
          <strong>{potential.name}</strong>
        </button>}
      </div>

      <form className={styles.otherRow} onSubmit={lookup}>
        <input type="text" className={styles.otherInput} placeholder="Autre QB"
          aria-label={`Autre QB pour ${recommendation.teamName ?? recommendation.team}`}
          value={query} maxLength={120} disabled={disabled} onChange={editName} />
        <button type="submit" className={styles.draftSubmit} disabled={disabled || query.trim().length < 2}>
          {pending === 'lookup' ? 'Recherche…' : 'Vérifier ESPN'}
        </button>
      </form>
      {matches.length > 1 && <div className={styles.identityMatches}>
        <p className={styles.note}>Sélectionne l’identité exacte.</p>
        {matches.map(match => <button key={match.id} type="button" className={styles.identityTile} disabled={disabled}
          aria-pressed={selection?.kind === 'other' && selection.athlete.id === match.id}
          onClick={() => choose({ kind: 'other', athlete: match })}>
          <strong>{match.name}</strong><span className={styles.note}>QB · {match.team} · ESPN {match.id}</span>
        </button>)}
      </div>}
      {selection?.kind === 'other' && <p className={styles.note} role="status">
        <strong>{selection.athlete.name}</strong> · QB · {selection.athlete.team} · ESPN {selection.athlete.id}
      </p>}
      {error && <p className={styles.decisionError} role="alert">{error}</p>}
      {stale && <p className={styles.note}>Actualise la fiche avant de confirmer.</p>}
      <button type="button" className={styles.draftSubmit} onClick={confirm} disabled={disabled || !selection}>
        {pending === 'confirm' ? 'Confirmation…' : 'Confirmer le titulaire'}
      </button>
    </div>
  );
}
