'use client';
import { useState } from 'react';
import { ROUNDS } from '../playoff-tree/treeData.mjs';
import { consensus, playerName, teamPathGroups } from '../playoff-tree/collectiveData.mjs';
import { homeSummary, selectedRound, roundData, qbGroups, seriesQBGroups, rankingRounds, pickStatistics } from './publicData.mjs';
import { usePlayoffData } from './usePlayoffData';
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
const shortcuts=[['matchs','✅','Mes choix','Faire mes prédictions','34,197,94'],['tous-les-choix','👀','Tous les choix','Voir les prédictions de tous','59,130,246'],['qb-ratings','📊','QB Ratings','Choix QB par ronde','236,72,153'],['classements','🏆','Classements','Ronde et séries','234,179,8'],['analytics','📈','Statistiques','Choix et historique','59,130,246']];
function HomeContent({data}){
 const summary=homeSummary(data);
 const profile=data.players.find(p=>p.id===data.userId);
 return <>
  <section className="card"><h2>Bienvenue {playerName(profile)} 👋</h2><div className={styles.toolbar}><span className={styles.tag}>{summary.round.title} · {statuses[summary.round.status] || 'À venir'}</span><strong>Mes choix : {summary.submission}</strong></div><p className={styles.muted}>{summary.next?`Prochain coup d’envoi : ${new Date(summary.next.game_date).toLocaleString('fr-CA',{dateStyle:'long',timeStyle:'short'})}`:'Aucun prochain coup d’envoi annoncé pour cette ronde.'}</p></section>
  <section className={styles.navGrid} aria-label="Accès aux séries">{shortcuts.map(([route,icon,title,subtitle,color])=><a key={route} href={`/series/${route}`} className="nav-card home-nav-card"><div className="nav-icon home-nav-icon" style={{background:`rgba(${color},.18)`}}>{icon}</div><div className="home-nav-text"><strong className="home-nav-title">{title}</strong><span className="home-nav-subtitle">{subtitle}</span></div></a>)}</section>

 </>;
}
export function HomeView(props){return <Shell title="Pool NFL 🏈" subtitle={`Prêt pour les séries${props.data?.season?` ${props.data.season}`:''}?`} {...props}>{props.data&&!props.data.requiresSignIn&&<HomeContent data={props.data}/>}</Shell>;}
function RankingContent({data}){
 const available=rankingRounds(data);
 const [key,setKey]=useState(null),[tab,setTab]=useState('round');
 const index=Math.max(0,available.findIndex(r=>r.key===(key || selectedRound(data).key)));
 const round=available[index];
 return <>
  <section className={`card ${styles.tabs}`} aria-label="Portée du classement"><button className={tab==='round'?'button':'button-secondary'} aria-pressed={tab==='round'} onClick={()=>setTab('round')}>Ronde</button><button className={tab==='series'?'button':'button-secondary'} aria-pressed={tab==='series'} onClick={()=>setTab('series')}>Séries</button></section>
  <div className={styles.columns}>
   <section className={`card ${styles.rankingPanel} ${tab!=='round'?styles.rankHidden:''}`}>
    <div className={styles.panelHeading}><div><div className={styles.roundArrows}>
     <button aria-label="Ronde précédente" disabled={index===0} onClick={()=>setKey(available[index-1].key)}>←</button>
     <h2>{round.title}</h2>
     <button aria-label="Ronde suivante" disabled={index===available.length-1} onClick={()=>setKey(available[index+1].key)}>→</button>
    </div><p>Classement de la ronde{index===available.length-1?' · ronde active':''}</p></div><span>📅</span></div>
    <p className={styles.muted}>En attente des scores officiels de la ronde.</p>
   </section>
   <section className={`card ${styles.rankingPanel} ${tab!=='series'?styles.rankHidden:''}`}>
    <div className={styles.panelHeading}><div><h2>Séries complètes</h2><p>Classement cumulatif</p></div><span>🏆</span></div>
    <p className={styles.muted}>En attente des scores officiels des séries.</p>
   </section>
  </div>
  <section className="card"><h2>Progression au classement 📈</h2><p className={styles.muted}>Aucun classement historique pour le moment.</p><div className={styles.progressAxis} aria-label="Rondes de progression">{ROUNDS.map(r=><span key={r.key}>{r.title}</span>)}</div></section>
 </>;
}
export function RankingsView(props){return <Shell title="Classements 🏆" subtitle="Ronde et séries complètes" {...props}>{props.data&&!props.data.requiresSignIn&&<RankingContent data={props.data}/>}</Shell>;}
function QBContent({data}){
 const groups=seriesQBGroups(data);
 return <>
 {!groups.length?<section className="card"><p>Aucun QB choisi dans les séries pour le moment.</p></section>:groups.map(g=><section className={`card ${styles.seriesQB}`} key={g.id}>
  <div className={styles.qbRank} aria-label="Rang en attente">—<small>Rang</small></div>
  <Image photo src={g.qb?.espn_athlete_id?`https://a.espncdn.com/i/headshots/nfl/players/full/${g.qb.espn_athlete_id}.png`:null}/>
  <div className={styles.qbName}><h2>{g.qb?.name || 'QB enregistré'}</h2>{g.qb?.team&&<Team name={g.qb.team} teams={data.teams}/>}<p className={styles.muted}>{g.players.join(', ')}</p></div>
  <div className={styles.ratingColumns}>{['Meilleur','Moyenne','Pire'].map((label,i)=><div className={`${styles.ratingBlock} ${i===0?styles.best:i===2?styles.worst:''}`} key={label}><span>{label}</span><strong>—</strong><p>En attente</p><small>{i===1?'Séries complètes':'Ronde à déterminer'}</small></div>)}</div>
 </section>)}
 </>;
}
export function QBView(props){return <Shell title="QB Ratings 📊" subtitle="Ratings et moyenne de chaque QB pendant les séries." {...props}>{props.data&&!props.data.requiresSignIn&&<QBContent data={props.data}/>}</Shell>;}
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
