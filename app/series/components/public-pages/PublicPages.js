'use client';
import { useState } from 'react';
import { ROUNDS } from '../playoff-tree/treeData.mjs';
import { consensus, playerName, teamPathGroups } from '../playoff-tree/collectiveData.mjs';
import { homeSummary, selectedRound, roundData, qbGroups, pickStatistics } from './publicData.mjs';
import { usePlayoffData, useLiveGames } from './usePlayoffData';
import styles from './PublicPages.module.css';

const statuses={draft:'En préparation',open:'Ouverte',locked:'Verrouillée',scored:'Calculée',finalized:'Clôturée'};
function Image({src,photo=false}){
 const [failed,setFailed]=useState(null);
 return src&&failed!==src?<img src={src} alt="" className={photo?styles.photo:styles.logo} onError={()=>setFailed(src)}/>:<span className={photo?styles.photo:styles.logo} aria-hidden="true">{photo?'QB':'🏈'}</span>;
}
function Team({name,teams}){
 const team=teams.find(t=>t.name===name);
 const src=team?.espn_abbr?`https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`:team?.logo;
 return <span className={styles.identity}><Image src={src}/><strong>{name}</strong></span>;
}
function Shell({title,subtitle,data,error,retry,children,stats=false}){
 return <main className={styles.page}><header className={stats?'card':'header-card'}><h1>{title}</h1><p className={styles.muted}>{subtitle}</p></header>
  {error?<section className="card" role="alert"><p>{error}</p><button className="button-secondary" onClick={retry}>Réessayer</button></section>
  :!data?<section className="card" role="status">Chargement des séries…</section>
  :data.requiresSignIn?<section className="card"><h2>Connexion requise</h2><p>Connecte-toi pour consulter les séries.</p><a className="button" href="/">Se connecter</a></section>:children}
 </main>;
}
function RoundSelector({round,onChange,season}){
 return <section className={`card ${styles.toolbar}`}><label>Ronde · Séries {season || 'à venir'}<select value={round.key} onChange={e=>onChange(e.target.value)}>{ROUNDS.map(r=><option key={r.key} value={r.key}>{r.title}</option>)}</select></label><span className={styles.tag}>{statuses[round.status] || 'À venir'}</span></section>;
}
function Empty({title,children}){return <div className={styles.empty}><span aria-hidden="true">🏈</span><strong>{title}</strong><p>{children}</p></div>;}
function GameList({games,teams,live={}}){
 if(!games.length)return <Empty title="Affrontements à déterminer">Les matchs apparaîtront lorsque la ronde sera préparée.</Empty>;
 return <ul className={styles.list}>{games.map(g=>{
  const official=g.away_score!=null&&g.home_score!=null;
  const state=g.game_status || live[g.id]?.state;
  const scores=official?`${g.away_score} – ${g.home_score}`:live[g.id]?`${live[g.id].awayScore} – ${live[g.id].homeScore}`:null;
  return <li key={g.id} className={styles.game}><div><div className={styles.identity}><Team name={g.away_team} teams={teams}/><span>@</span><Team name={g.home_team} teams={teams}/></div><p className={styles.muted}>{new Date(g.game_date).toLocaleString('fr-CA',{dateStyle:'medium',timeStyle:'short'})}</p></div><div><span className={styles.tag}>{state==='post'?'FINAL':state==='in'?'LIVE':g.external_game_id?.startsWith('TEST-')?'TEST':'À venir'}</span>{scores&&<p><strong>{scores}</strong> · {official?'Score enregistré':'ESPN provisoire'}</p>}</div></li>;
 })}</ul>;
}
const shortcuts=[['matchs','✅','Mes choix','Faire mes prédictions','34,197,94'],['tous-les-choix','👀','Tous les choix','Voir les prédictions de tous','59,130,246'],['qb-ratings','📊','QB Ratings','Choix QB par ronde','236,72,153'],['classements','🏆','Classements','Ronde et séries','234,179,8'],['analytics','📈','Statistiques','Choix et historique','59,130,246']];
function HomeContent({data}){
 const summary=homeSummary(data);const live=useLiveGames(summary.games);
 const profile=data.players.find(p=>p.id===data.userId);
 return <>
  <section className="card"><h2>Bienvenue {playerName(profile)} 👋</h2><div className={styles.toolbar}><span className={styles.tag}>{summary.round.title} · {statuses[summary.round.status] || 'À venir'}</span><strong>Mes choix : {summary.submission}</strong></div><p className={styles.muted}>{summary.next?`Prochain coup d’envoi : ${new Date(summary.next.game_date).toLocaleString('fr-CA',{dateStyle:'long',timeStyle:'short'})}`:'Aucun prochain coup d’envoi annoncé pour cette ronde.'}</p></section>
  <section className={styles.navGrid} aria-label="Accès aux séries">{shortcuts.map(([route,icon,title,subtitle,color])=><a key={route} href={`/series/${route}`} className="nav-card home-nav-card"><div className="nav-icon home-nav-icon" style={{background:`rgba(${color},.18)`}}>{icon}</div><div className="home-nav-text"><strong className="home-nav-title">{title}</strong><span className="home-nav-subtitle">{subtitle}</span></div></a>)}</section>
  <div className={styles.columns}><section className="card"><h2>Prédiction Super Bowl 🏆</h2>{summary.path?<><Team name={summary.path.team} teams={data.teams}/>{summary.path.multiplier!=null&&<p>Multiplicateur enregistré : ×{summary.path.multiplier}</p>}</>:<p className={styles.muted}>Aucune prédiction enregistrée pour cette ronde.</p>}</section><section className="card"><h2>Mon QB</h2><p>{summary.qb?.qbs?.name || (summary.qb?'QB enregistré':'Aucun QB soumis pour cette ronde.')}</p><p className={styles.muted}>Un choix par ronde. Plusieurs participants peuvent choisir le même QB.</p></section></div>
  <section className="card"><h2>{summary.round.title} — Matchs</h2><GameList games={summary.games} teams={data.teams} live={live}/></section>
 </>;
}
export function HomeView(props){return <Shell title="Pool NFL 🏈" subtitle={`Prêt pour les séries${props.data?.season?` ${props.data.season}`:''}?`} {...props}>{props.data&&!props.data.requiresSignIn&&<HomeContent data={props.data}/>}</Shell>;}
function RankingContent({data}){
 const [key,setKey]=useState(null),[tab,setTab]=useState('round');const round=selectedRound(data,key);
 return <><RoundSelector round={round} onChange={setKey} season={data.season}/><section className={`card ${styles.tabs}`} aria-label="Portée du classement"><button className={tab==='round'?'button':'button-secondary'} aria-pressed={tab==='round'} onClick={()=>setTab('round')}>Ronde</button><button className={tab==='series'?'button':'button-secondary'} aria-pressed={tab==='series'} onClick={()=>setTab('series')}>Séries</button></section>
  <div className={styles.columns}>{[['round',round.title,'Classement de la ronde'],['series','Séries complètes','Classement cumulatif']].map(([mode,title,subtitle])=><section key={mode} className={`card ${tab!==mode?styles.rankHidden:''}`}><h2>{title}</h2><p className={styles.muted}>{subtitle}</p><Empty title="Classement à venir">Les points des séries ne sont pas encore disponibles. Aucun classement n’est attribué avant leur validation.</Empty></section>)}</div>
  <section className="card"><h2>Progression des séries</h2><div className={styles.progress}>{ROUNDS.map(r=>{const row=data.rounds.find(x=>x.round_key===r.key);return <div className={styles.inset} key={r.key}><strong>{r.title}</strong><p className={styles.muted}>{statuses[row?.status] || 'À venir'}</p><span>Classement : —</span></div>;})}</div></section>
 </>;
}
export function RankingsView(props){return <Shell title="Classements 🏆" subtitle="Ronde et séries complètes" {...props}>{props.data&&!props.data.requiresSignIn&&<RankingContent data={props.data}/>}</Shell>;}
function QBContent({data}){
 const [key,setKey]=useState(null);const round=selectedRound(data,key),groups=qbGroups(data,round);
 return <><RoundSelector round={round} onChange={setKey} season={data.season}/><section className="card"><p className={styles.muted}>Les choix sont regroupés par QB, sans ordre de sélection entre participants. Les ratings officiels des séries ne sont pas encore disponibles.</p></section>
 {!groups.length?<section className="card"><Empty title="Aucun QB soumis">Les choix de cette ronde apparaîtront ici.</Empty></section>:groups.map(g=><section className={`card ${styles.qbCard}`} key={g.id}><Image photo src={g.qb?.espn_athlete_id?`https://a.espncdn.com/i/headshots/nfl/players/full/${g.qb.espn_athlete_id}.png`:null}/><div><h2>{g.qb?.name || 'QB enregistré'}</h2>{g.qb?.team&&<Team name={g.qb.team} teams={data.teams}/>}<p className={styles.muted}>{g.players.join(', ')}</p></div><div className={styles.qbDetails}><div className={styles.inset}>Passer rating<strong>En attente</strong><p className={styles.muted}>Aucun résultat officiel enregistré.</p></div><div className={styles.inset}>Choisi par<strong>{g.players.length} participant(s)</strong><p className={styles.muted}>{round.title}</p></div></div></section>)}
 </>;
}
export function QBView(props){return <Shell title="QB Ratings 📊" subtitle="Choix et résultats QB par ronde des séries." {...props}>{props.data&&!props.data.requiresSignIn&&<QBContent data={props.data}/>}</Shell>;}
function Stat({title,value,subtitle}){return <div className={styles.stat}><span>{title}</span><strong>{value}</strong><small className={styles.muted}>{subtitle}</small></div>;}
function AnalyticsContent({data}){
 const [key,setKey]=useState(null);const round=selectedRound(data,key),scoped=roundData(data,round),stats=pickStatistics(scoped.games,scoped.picks);
 const paths=teamPathGroups(scoped.paths,round.id);
 return <><RoundSelector round={round} onChange={setKey} season={data.season}/>
  <section className="card"><h2>📊 Choix de la ronde</h2><div className={styles.stats}><Stat title="Choix enregistrés" value={scoped.picks.length} subtitle="Prédictions de matchs"/><Stat title="Bons gagnants" value={stats.evaluated?`${stats.correct}/${stats.evaluated}`:'—'} subtitle="Choix évaluables sur matchs FINAL officiels"/><Stat title="Exactitude" value={stats.accuracy==null?'—':`${stats.accuracy}%`} subtitle="Gagnants correctement prédits"/><Stat title="Gagnant et écart exacts" value={stats.evaluated?stats.exact:'—'} subtitle="Sans calcul de points"/></div>{!stats.evaluated&&<p className={styles.muted}>Les résultats apparaîtront après l’enregistrement de résultats FINAL officiels. Les matchs TEST sont exclus de l’exactitude.</p>}</section>
  <section className="card"><h2>👀 Répartition des choix</h2>{!scoped.games.length?<Empty title="Aucun match annoncé">Affrontements à déterminer.</Empty>:<ul className={styles.list}>{scoped.games.map(g=>{const c=consensus(g,scoped.picks);return <li key={g.id} className={styles.game}><Team name={g.away_team} teams={data.teams}/><strong>{c.away.length} choix · {c.home.length} choix</strong><Team name={g.home_team} teams={data.teams}/></li>;})}</ul>}</section>
  <div className={styles.columns}><section className="card"><h2>🏆 Prédiction Super Bowl</h2>{paths.length?<ul className={styles.list}>{paths.map(g=><li className={styles.game} key={g.team}><Team name={g.team} teams={data.teams}/><strong>{g.rows.length} prédiction(s)</strong></li>)}</ul>:<p className={styles.muted}>Aucune prédiction enregistrée pour cette ronde.</p>}</section><section className="card"><h2>📊 QB choisis</h2>{qbGroups(data,round).length?<ul className={styles.list}>{qbGroups(data,round).map(g=><li key={g.id}><strong>{g.qb?.name || 'QB enregistré'}</strong><p className={styles.muted}>{g.players.length} participant(s)</p></li>)}</ul>:<p className={styles.muted}>Aucun choix QB pour cette ronde.</p>}</section></div>
  <section className="card"><h2>Évolution par ronde</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ronde</th><th>Choix</th><th>Bons gagnants</th><th>Exactitude</th></tr></thead><tbody>{ROUNDS.map(r=>{const d=roundData(data,selectedRound(data,r.key)),s=pickStatistics(d.games,d.picks);return <tr key={r.key}><th scope="row">{r.title}</th><td>{d.picks.length}</td><td>{s.evaluated?`${s.correct}/${s.evaluated}`:'—'}</td><td>{s.accuracy==null?'—':`${s.accuracy}%`}</td></tr>;})}</tbody></table></div></section>
 </>;
}
export function AnalyticsView(props){return <Shell title="📊 Statistiques" subtitle="Choix, tendances et historique des séries." stats {...props}>{props.data&&!props.data.requiresSignIn&&<AnalyticsContent data={props.data}/>}</Shell>;}
export function PublicPage({kind}){
 const props=usePlayoffData();const View={home:HomeView,rankings:RankingsView,qb:QBView,analytics:AnalyticsView}[kind];
 return <View {...props}/>;
}
