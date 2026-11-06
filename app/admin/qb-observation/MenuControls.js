'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { torontoDate } from '../../../lib/notifications/adminLog.mjs';
import { getQbHeadshot, teamLogoUrl } from '../../components/weekly-summary/presentation.mjs';
import styles from './journal.module.css';

function CandidateImage({ candidate, team }) {
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const headshot = /^\d{1,18}$/.test(candidate.espnId)
    ? getQbHeadshot({ espn_athlete_id: candidate.espnId }) : null;
  const logo = /^[A-Z]{2,3}$/.test(team.abbr)
    ? teamLogoUrl(team.name, [{ name: team.name, espn_abbr: team.abbr }]) : null;
  return (
    <div className={styles.candidate}>
      {headshot && !headshotFailed && (
        <img src={headshot} alt="" width="56" height="42" onError={() => setHeadshotFailed(true)} />
      )}
      {logo && !logoFailed && (
        <img src={logo} alt="" width="28" height="28" onError={() => setLogoFailed(true)} />
      )}
      <div><strong>{candidate.name}</strong><span className={styles.note}>ESPN {candidate.espnId}</span></div>
    </div>
  );
}

function Correction({ context, entry, busy, onClose, onApply }) {
  const heading = useRef(null);
  const searchVersion = useRef(0);
  const [abbr, setAbbr] = useState(entry?.team ?? '');
  const [action, setAction] = useState('assign');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const team = context.teams.find(item => item.abbr === abbr);
  const candidate = entry
    ? { name: entry.newQB.name, espnId: entry.espnAthleteId }
    : selected;

  useEffect(() => {
    heading.current?.focus();
    return () => { searchVersion.current += 1; };
  }, []);

  async function searchCatalog(event) {
    event.preventDefault();
    const search = query.trim();
    if (searching || !team || search.length < 2 || /[%_*\\]/.test(search)) return;
    const request = ++searchVersion.current;
    setSearchError(null);
    setSearching(true);
    setMatches(null);
    setSelected(null);
    try {
      const { data, error } = await supabase.from('qbs')
        .select('id,name,espn_athlete_id,team')
        .eq('active', true)
        .ilike('name', `%${search}%`)
        .order('name')
        .limit(20);
      if (request !== searchVersion.current) return;
      if (error) throw error;
      setMatches((data ?? []).filter(row => /^\d{1,18}$/.test(row.espn_athlete_id)));
    } catch {
      if (request === searchVersion.current) setSearchError('Recherche indisponible. Réessaie.');
    } finally {
      if (request === searchVersion.current) setSearching(false);
    }
  }

  const canApply = team && note.trim() && (action === 'unavailable' || candidate);
  return (
    <div className={styles.editor}>
      <h3 ref={heading} tabIndex={-1}>{entry ? 'Vérifier le signal' : 'Corriger le titulaire'}</h3>
      <label className={styles.label} htmlFor="qb-menu-team">Équipe</label>
      <select id="qb-menu-team" className="input" value={abbr} disabled={busy || Boolean(entry)} onChange={event => {
        searchVersion.current += 1;
        setAbbr(event.target.value);
        setMatches(null);
        setSearching(false);
        setSearchError(null);
        setSelected(null);
      }}>
        <option value="">Choisir l’équipe</option>
        {context.teams.map(item => <option key={item.abbr} value={item.abbr}>{item.name} · {item.abbr}</option>)}
      </select>
      {team && <p className={styles.note}>
        {team.qbName ? `QB proposé · ${team.qbName}` : 'Aucun QB proposé'}
        {team.reserved && ' · Équipe réservée. Le choix soumis est conservé.'}
      </p>}
      {!entry && <>
        <label className={styles.label} htmlFor="qb-menu-action">Action</label>
        <select id="qb-menu-action" className="input" value={action} disabled={busy} onChange={event => setAction(event.target.value)}>
          <option value="assign">Définir le titulaire confirmé</option>
          <option value="unavailable">Retirer le QB indisponible du menu</option>
        </select>
      </>}
      {action === 'assign' && !entry && (
        <form onSubmit={searchCatalog}>
          <label className={styles.label} htmlFor="qb-menu-search">Rechercher un QB par nom</label>
          <div className={styles.search}>
            <input id="qb-menu-search" className="input" value={query} minLength={2} maxLength={100}
              onChange={event => setQuery(event.target.value)} disabled={!team || busy || searching} />
            <button type="submit" className="button-secondary" disabled={!team || query.trim().length < 2
              || /[%_*\\]/.test(query) || busy || searching}>{searching ? 'Recherche…' : 'Rechercher'}</button>
          </div>
          {searchError && <p role="alert">{searchError}</p>}
          {matches?.length === 0 && <p>Aucun QB trouvé dans le catalogue.</p>}
          {matches?.length > 0 && (
            <fieldset className={styles.matches}>
              <legend>Choisir l’identité exacte</legend>
              {matches.map(row => (
                <label key={row.id}>
                  <input type="radio" name="qb-menu-player" checked={selected?.id === row.id} disabled={busy}
                    onChange={() => setSelected({ id: row.id, name: row.name, espnId: row.espn_athlete_id })} />
                  <span>{row.name} · {row.team} · ESPN {row.espn_athlete_id}</span>
                </label>
              ))}
            </fieldset>
          )}
        </form>
      )}
      {action === 'assign' && candidate && team && (
        <CandidateImage key={`${team.abbr}:${candidate.espnId}`} candidate={candidate} team={team} />
      )}
      {entry && <p className={styles.note}>Le signal doit être confirmé par une annonce explicite pour ce match.</p>}
      <form onSubmit={event => {
        event.preventDefault();
        if (!canApply || busy) return;
        onApply({
          p_season: context.season,
          p_week: context.week,
          p_team: abbr,
          p_action: action,
          p_qb_id: action === 'assign' && !entry ? candidate.id : null,
          p_note: note.trim(),
          p_entry_id: entry?.entryId ?? null,
        });
      }}>
        <label className={styles.label} htmlFor="qb-menu-note">Motif factuel et source de confirmation</label>
        <textarea id="qb-menu-note" className="input" required value={note} maxLength={500}
          placeholder="Indique la confirmation obtenue et sa source." disabled={busy}
          onChange={event => setNote(event.target.value)} />
        <div className={styles.actions}>
          <button type="submit" className="button" disabled={!canApply || busy}>
            {action === 'assign' ? 'Confirmer le titulaire' : 'Confirmer l’indisponibilité'}
          </button>
          <button type="button" className="button-secondary" disabled={busy} onClick={onClose}>Annuler</button>
        </div>
      </form>
    </div>
  );
}

export default function MenuControls({ context, draft, busy, onEdit, onClose, onApply, onCheck }) {
  return (
    <section className="card" aria-labelledby="qb-menu-controls">
      <h2 id="qb-menu-controls">Titulaires proposés cette semaine</h2>
      {!context ? <p>Commandes du menu indisponibles.</p> : <>
        {context.week != null && <p>Saison {context.season} · Semaine {context.week}</p>}
        <p className={styles.note}>
          {context.canCheck ? `Gel au premier coup d’envoi · ${torontoDate(context.firstKickoffAt)}`
            : 'Fenêtre hebdomadaire fermée.'}
        </p>
        {!context.enabled && <p className={styles.note}>Le menu hebdomadaire est désactivé.</p>}
        {context.canCheck && context.enabled && !context.open && (
          <p className={styles.note}>Une vérification du calendrier est nécessaire avant toute correction.</p>
        )}
        {context.canCheck && <div className={styles.actions}>
          <button type="button" className="button-secondary" disabled={busy} onClick={onCheck}>Relancer la vérification</button>
          {context.open && !draft && (
            <button type="button" className="button-secondary" disabled={busy} onClick={onEdit}>Corriger un titulaire</button>
          )}
        </div>}
        {context.open && context.enabled && draft && (
          <Correction key={draft.entry?.entryId ?? 'manual'} context={context} entry={draft.entry}
            busy={busy} onClose={onClose} onApply={onApply} />
        )}
      </>}
    </section>
  );
}
