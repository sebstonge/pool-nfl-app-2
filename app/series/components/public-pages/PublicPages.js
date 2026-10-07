'use client';
import { useState, useEffect } from 'react';
import {usePublicSeriesUrls} from '../SeriesLinks';
import {seriesHref} from '../../../../lib/lifecycle/publicRouting.mjs';
import { ROUNDS } from '../playoff-tree/treeData.mjs';
import { consensus, playerName, teamPathGroups } from '../playoff-tree/collectiveData.mjs';
import { homeSummary, selectedRound, roundData, qbGroups, rankingRounds, pickStatistics } from './publicData.mjs';
import { usePlayoffData } from './usePlayoffData';
import styles from './PublicPages.module.css';

import {processedPlayoffResults} from './processedResults.mjs';
import {SeriesQBRow} from './RegularQB';
import RegularUserCard from './RegularUserCard';
import ResultRows from './RegularRanking';
import RankProgressionChart from './RegularProgression';
import {supabase} from '../../../../lib/supabase';
import {isPreviewAdmin} from '../admin-preview/previewAdmin.mjs';
function useViewport(){
 const [width,setWidth]=useState(0);
 useEffect(()=>{const update=()=>setWidth(window.innerWidth);update();window.addEventListener('resize',update);return()=>window.removeEventListener('resize',update);},[]);
 return {isDesktop:width>=900,isMobile:width<700};
}
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
function Shell({title,subtitle,data,error,retry,children,stats=false,regular}){
 const {isDesktop}=useViewport();
 return <main className={regular?'page':styles.page} style={regular?{maxWidth:isDesktop?1280:regular==='qb'?1100:undefined,width:isDesktop?'calc(100% - 48px)':undefined,margin:isDesktop?'0 auto':undefined,paddingTop:isDesktop?112:undefined}:undefined}><header className={stats?'card':'header-card'} style={regular&&isDesktop?{padding:regular==='home'?'28px 32px':'26px 30px',marginBottom:regular==='home'?20:18}:undefined}><h1 style={regular==='home'&&isDesktop?{marginBottom:6}:regular==='qb'?{fontSize:!isDesktop?44:undefined,lineHeight:1.05,whiteSpace:'nowrap'}:undefined}>{title}</h1><p className={styles.muted}>{subtitle}</p></header>
  {error?<section className="card" role="alert"><p>{error}</p><button className="button-secondary" onClick={retry}>Réessayer</button></section>
  :!data?<section className="card" role="status">Chargement des séries…</section>
  :data.requiresSignIn?<section className="card"><h2>Connexion requise</h2><p>Connecte-toi pour consulter les séries.</p><a className="button" href="/">Se connecter</a></section>:children}
 </main>;
}
function RoundSelector({round,onChange,season}){
 return <section className={`card ${styles.toolbar}`}><label>Ronde · Séries {season || 'à venir'}<select value={round.key} onChange={e=>onChange(e.target.value)}>{ROUNDS.map(r=><option key={r.key} value={r.key}>{r.title}</option>)}</select></label><span className={styles.tag}>{statuses[round.status] || 'À venir'}</span></section>;
}
function Empty({title,children}){return <div className={styles.empty}><span aria-hidden="true">🏈</span><strong>{title}</strong><p>{children}</p></div>;}
const shortcuts=[['matchs','✅','Mes choix','Faire mes prédictions','34,197,94'],['tous-les-choix','👀','Tous les choix','Voir les prédictions de tous','59,130,246'],['qb-ratings','📊','QB Ratings','Ratings des séries','236,72,153'],['classements','🏆','Classements','Ronde et séries','234,179,8'],['analytics','📈','Statistiques','Records et statistiques','59,130,246']];
function HomeContent({data}){
 const publicUrls=usePublicSeriesUrls();
 const viewport=useViewport();
 const [admin,setAdmin]=useState(false);
 useEffect(()=>{let active=true;isPreviewAdmin(supabase).then(value=>{if(active)setAdmin(value);});return()=>{active=false;};},[data.userId]);
 const profile=data.players.find(p=>p.id===data.userId);
 return <>
  <RegularUserCard profile={profile} user={{id:data.userId}} {...viewport}/>

  <section className={styles.navGrid} aria-label="Accès aux séries">{[...shortcuts,...(admin?[['../admin/playoffs','⚙️','Admin','Scores, stats et calculs','148,163,184']]:[])].map(([route,icon,title,subtitle,color])=><a key={route} href={route.startsWith('../')?'/admin/playoffs':seriesHref(`/series/${route}`,publicUrls)} className="nav-card home-nav-card"><div className="nav-icon home-nav-icon" style={{background:`rgba(${color},.18)`}}>{icon}</div><div className="home-nav-text"><strong className="home-nav-title">{title}</strong><span className="home-nav-subtitle">{subtitle}</span></div></a>)}</section>

 </>;
}
export function HomeView(props){return <Shell regular="home" title="Pool NFL 🏈" subtitle={`Prêt pour les séries${props.data?.season?` ${props.data.season}`:''}?`} {...props}>{props.data&&!props.data.requiresSignIn&&<HomeContent data={props.data}/>}</Shell>;}
function RankingContent({data}){
 const {isDesktop}=useViewport();
 const available=rankingRounds(data);
 const [key,setKey]=useState(null),[tab,setTab]=useState('round');
 const index=Math.max(0,available.findIndex(r=>r.key===(key || selectedRound(data).key)));
 const round={...available[index],...data.rounds.find(r=>r.round_key===available[index].key)};
 const results=processedPlayoffResults(data);
 return <>
  <section className={`card ${styles.tabs}`} aria-label="Portée du classement"><button className={tab==='round'?'button':'button-secondary'} aria-pressed={tab==='round'} onClick={()=>setTab('round')}>Ronde</button><button className={tab==='series'?'button':'button-secondary'} aria-pressed={tab==='series'} onClick={()=>setTab('series')}>Séries</button></section>
  <div className={styles.columns}>
   <section className={`card ${styles.rankingPanel} ${tab!=='round'?styles.rankHidden:''}`}>
    <div className={styles.panelHeading}><div><div className={styles.roundArrows}>
     <button aria-label="Ronde précédente" disabled={index===0} onClick={()=>setKey(available[index-1].key)}>←</button>
     <h2>{round.title}</h2>
     <button aria-label="Ronde suivante" disabled={index===available.length-1} onClick={()=>setKey(available[index+1].key)}>→</button>
    </div><p>Classement de la ronde{index===available.length-1?' · ronde active':''}</p></div><span>📅</span></div>
    <ResultRows isDesktop={isDesktop} rows={results.roundRows(round.id)} empty="En attente des scores officiels de la ronde."/>
   </section>
   <section className={`card ${styles.rankingPanel} ${tab!=='series'?styles.rankHidden:''}`}>
    <div className={styles.panelHeading}><div><h2>Séries complètes</h2><p>Classement cumulatif</p></div><span>🏆</span></div>
    <ResultRows isDesktop={isDesktop} rows={results.cumulativeRows} empty="En attente des scores officiels des séries."/>
   </section>
  </div>
  <RankProgressionChart isDesktop={isDesktop} playerCount={data.players.length} progression={processedPlayoffResults(data).progression}/>

 </>;
}
export function RankingsView(props){return <Shell title="Classements 🏆" subtitle="Ronde et séries complètes" {...props}>{props.data&&!props.data.requiresSignIn&&<RankingContent data={props.data}/>}</Shell>;}
function QBContent({data}){
 const {isDesktop}=useViewport();
 const rows=processedPlayoffResults(data).qbRows;
 return <>{!rows.length?<section className="card"><p>Aucun rating QB validé pour le moment.</p></section>:rows.map(row=>{
 const qb=row.qb;
 const team=data.teams.find(t=>t.name?.trim().toLowerCase()===qb.team?.trim().toLowerCase());
 const logo=team?.espn_abbr?`https://a.espncdn.com/i/teamlogos/nfl/500/${team.espn_abbr.toLowerCase()}.png`:team?.logo;
 return <SeriesQBRow key={qb.id} row={row} teamLogo={logo} isDesktop={isDesktop}/>;
 })}</>;
}
export function QBView(props){return <Shell regular="qb" title="QB Ratings 📊" subtitle="Ratings et moyenne de chaque QB pendant les séries." {...props}>{props.data&&!props.data.requiresSignIn&&<QBContent data={props.data}/>}</Shell>;}
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
