"use client";

import {useEffect, useState} from 'react';
import {SeasonalHomeNavSample} from '../../RegularPage';
import {SeasonalSubmittedGameSample} from '../../matchs/RegularPage';
import {SeasonalCollectiveGameSample} from '../../tous-les-choix/RegularPage';
import BottomNav from '../BottomNav';
import useSeasonalTheme from './useSeasonalTheme';
import styles from './preview.module.css';

// Local illustrations only. The real card components render them without mounting
// any regular page, session loader, submission handler or ESPN polling effect.
const games = [
  {id:'local-a',away_team:'Bills',home_team:'Lions'},
  {id:'local-b',away_team:'Cowboys',home_team:'Eagles'},
  {id:'local-c',away_team:'Packers',home_team:'Bears'},
].map((game, index) => ({...game,season:2026,week:7,
  game_date:`2026-10-${22 + index}T20:25:00Z`,is_pool_eligible:true,
  away_score:null,home_score:null,result_status:null,
}));
const abbreviations = {Bills:'buf',Lions:'det',Cowboys:'dal',Eagles:'phi',Packers:'gb',Bears:'chi'};
const getTeamLogo = team => `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviations[team]}.png`;
const formatTeamRecord = () => '';
const player = {id:'local-player',display_name:'Alex',real_name:'Alex'};

export default function SeasonalPreview() {
  const [width,setWidth] = useState(1280);
  const [page,setPage] = useState('matchs');
  const {theme,pageClassName,gameAccent} = useSeasonalTheme(games,{activeWeek:7,season:2026});
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    resize();
    const requested = new URLSearchParams(window.location.search).get('page');
    if (['home','matchs','tous-les-choix'].includes(requested)) setPage(requested);
    window.addEventListener('resize',resize);
    return () => window.removeEventListener('resize',resize);
  },[]);
  if (process.env.NODE_ENV !== 'development') return null;
  const isDesktop = width >= 900, isMobile = width < 700;
  const pick = game => ({id:`local-pick-${game.id}`,user_id:player.id,game_id:game.id,picked_team:game.away_team,predicted_spread:7});
  return <>
    <aside className={styles.notice}>Aperçu local · données d’illustration · aucune soumission</aside>
    <main className={`page ${styles.page} ${pageClassName}`} data-seasonal-theme={theme || undefined} data-preview-width={width}>
      <section className="header-card">
        <h1>{page === 'home' ? 'Pool NFL 🏈' : page === 'matchs' ? 'Mes choix ✅' : 'Tous les choix 👀'}</h1>
        <p>{page === 'home' ? 'Prêt pour la semaine?' : page === 'matchs' ? 'Semaine 7' : 'Choix de tous les joueurs pour la semaine 7.'}</p>
      </section>
      {page === 'home' ? <div className={styles.homeGrid}>
        <SeasonalHomeNavSample href="/matchs" icon="✅" title="Mes choix" subtitle="Faire mes prédictions" color="rgba(34,197,94,0.15)" />
        <SeasonalHomeNavSample href="/tous-les-choix" icon="👀" title="Tous les choix" subtitle="Voir les prédictions de tous" color="rgba(59,130,246,0.15)" />
        <SeasonalHomeNavSample href="/qb-ratings" icon="📊" title="QB Ratings" subtitle="Ratings et moyennes" color="rgba(168,85,247,0.15)" />
      </div> : page === 'matchs' ? <section className="card">
        <h2 className={styles.heading}>Tes choix de matchs ✅</h2>
        <div className={styles.games}>
          {games.map((game,index) => <div key={game.id} data-seasonal-accent={gameAccent(game,index) || undefined} className={styles.submitted}>
            <SeasonalSubmittedGameSample game={game} pick={pick(game)} liveGame={null} getTeamLogo={getTeamLogo} formatTeamRecord={formatTeamRecord} isMobile={isMobile} isDesktop={isDesktop}/>
          </div>)}
        </div>
      </section> : <div className={styles.games}>
        {games.map((game,index) => <SeasonalCollectiveGameSample key={game.id} game={game} seasonalAccent={gameAccent(game,index) || undefined} gamePicks={[pick(game)]} players={[player]} getTeamLogo={getTeamLogo} formatTeamRecord={formatTeamRecord} isMobile={isMobile} isDesktop={isDesktop} liveGame={null} qbPicks={[]} qbRatings={[]} liveGames={{}} />)}
      </div>}
      <BottomNav />
    </main>
  </>;
}
