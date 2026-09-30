import { RoundError, official, assertMatchups, expectedMatchups } from './rounds.mjs';
import { gameUpdate } from './roundEspn.mjs';
import { calculateRound, finalWinner } from './scoring.mjs';
import { resolveQB, summaryQuarterbacks } from './qbResults.mjs';
export async function scoringState(client,season) {
  const {data,error}=await client.rpc('playoff_scoring_state',{p_season:season});
  if(error)throw new RoundError(['42883','PGRST202'].includes(error.code)?'Migration de scoring Playoffs non installée.':`Lecture scoring refusée : ${error.message}`);
  return data;
}
export async function completeUpdate(client,{season,roundKey,action='update'},fetcher=fetch) {
  const state=await scoringState(client,season);
  const round=state.rounds.find(r=>r.round_key===roundKey);
  if(!round || !['open','locked','scored'].includes(round.status))throw new RoundError('Ronde non active ou finalisée.');
  const prior=state.rounds.filter(r=>r.round_order<round.round_order);
  if(prior.length!==round.round_order-1||prior.some(r=>r.status!=='finalized'||!state.runs.some(run=>run.round_id===r.id)))
    throw new RoundError('Les rondes précédentes doivent avoir des résultats traités et finalisés.');
  if(state.rounds.some(r=>r.round_order>round.round_order&&r.status!=='draft'))throw new RoundError('Une ronde suivante est déjà active.');
  const games=state.games.filter(g=>g.round_id===round.id);
  if(!games.length)throw new RoundError('Aucun match dans cette ronde.');
  if(games.some(g=>!official(g)&&!String(g.external_game_id).startsWith('TEST-')))throw new RoundError('Identifiant de match invalide.');
  // TEST fixtures are intentionally not constrained to six WC games. Never mix
  // official and fixture games; real schedules keep the existing reseeding gate.
  const testMode=games.every(g=>String(g.external_game_id).startsWith('TEST-'));
  if(!testMode)assertMatchups(games,expectedMatchups(state.seeds,season,roundKey,state.rounds,state.games),roundKey);
  if(action==='finalize'){
    const {error}=await client.rpc('publish_playoff_scoring',{p_season:season,p_round_id:round.id,p_action:'finalize',p_expected:state,p_updates:[],p_publication:null});
    if(error)throw new RoundError(`Finalisation refusée : ${error.message}`);
    return {message:'Ronde finalisée. Ses résultats sont désormais immuables.'};
  }
  const summaries=new Map();
  const cachedFetch=async(url,options)=>{
    const response=await fetcher(url,options);
    if(!response.ok)return response;
    const json=await response.json();summaries.set(String(json.header?.id),json);
    return {ok:true,json:async()=>json};
  };
  const updates=[];
  for(const game of games){
    if(!official(game))continue; // Absolute TEST-* guard, before every network call.
    updates.push(await gameUpdate(game,{season,seeds:state.seeds,teams:state.teams,fetcher:cachedFetch}));
  }
  const updated=games.map(g=>({...g,...updates.find(u=>u.id===g.id)}));
  let publication=null;
  const warnings=[];
  if(updated.every(finalWinner)){
    try {
      const qbPicks=state.qbPicks.filter(p=>p.round_id===round.id),qbResults={};
      for(const pick of qbPicks){
        const qb=state.qbs.find(q=>q.id===pick.qb_id);
        const game=qb&&updated.find(g=>[g.home_team,g.away_team].includes(qb.team));
        if(!game)throw new RoundError('QB sélectionné sans match.');
        const players=String(game.external_game_id).startsWith('TEST-')
          ? (game.test_qb_results||[]).filter(p=>p.team===qb.team)
          : summaryQuarterbacks(summaries.get(game.external_game_id),state.teams.find(t=>t.name===qb.team)?.espn_abbr);
        qbResults[pick.user_id]=resolveQB(qb,players,game);
      }
      publication=calculateRound({round,games:updated,picks:state.picks.filter(p=>updated.some(g=>g.id===p.game_id)),qbPicks,
        paths:state.paths.filter(p=>p.round_id===round.id),qbs:state.qbs,seeds:state.seeds,
        previousResults:state.results.filter(r=>r.round_order<round.round_order),qbResults});
    }catch(error){if(!(error instanceof RoundError))throw error;warnings.push(error.message);}
  }else warnings.push('Classements en attente : tous les matchs de la ronde ne sont pas FINAL.');
  const {error}=await client.rpc('publish_playoff_scoring',{p_season:season,p_round_id:round.id,p_action:'update',p_expected:state,p_updates:updates,p_publication:publication});
  if(error)throw new RoundError(`Mise à jour refusée, aucune écriture partielle : ${error.message}`);
  return {warnings,message:publication?'Résultats, QB Ratings et classements calculés. Vérifie-les avant de finaliser.':'Scores actualisés. Aucun classement incomplet publié.'};
}
