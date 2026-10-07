import {validateLifecycle,regularIsOpen} from '../lifecycle/context.mjs';
import {fetchEspnStandings} from '../espnStandings.mjs';
import {extractEspnSeeds,validateSeedRows} from '../playoffs/seeds.mjs';
import {discoverGames} from '../playoffs/roundEspn.mjs';
import {ROUNDS,assertMatchups} from '../playoffs/rounds.mjs';
export class TransitionError extends Error {}
export function requireTransition(ok,message){if(!ok)throw new TransitionError(message);}
const identity=rows=>rows.map(({season,team,espn_team_id,conference,seed})=>({season,team,espn_team_id,conference,seed})).sort((a,b)=>a.conference.localeCompare(b.conference)||a.seed-b.seed);
export function checkContext(state,season,revision){
 const c=validateLifecycle(state.regular?.settings);
 requireTransition(c.phase!=='playoffs','Déjà en Séries : aucune transition supplémentaire.');
 requireTransition(regularIsOpen(c)&&c.current_season===season&&c.revision===revision,'Contexte lifecycle fermé, mauvaise saison ou révision périmée.');
 requireTransition(c.playoff_reminders_enabled===false,'Les rappels doivent rester désactivés pour cette transition.');
 requireTransition(state.publication_valid===true&&state.publication?.season===season&&state.publication?.lifecycle_revision===revision,'Publication finale régulière absente ou périmée.');
}
export function checkConflicts(state){
 for(const r of state.rounds){const def=ROUNDS[r.round_order-1];requireTransition(def&&def.key===r.round_key&&r.status==='draft'&&!r.reminder_opened_at,`Ronde incompatible : ${r.round_key} (id ${r.id}, état ${r.status}).`);}
 for(const g of state.games)throw new TransitionError(`Match existant à préserver : ${g.external_game_id||'sans identifiant ESPN'} (id ${g.id}, ronde ${g.round_id}). Wild Card doit être vide ; aucune suppression automatique.`);
 for(const key of ['picks','qb_picks','paths','runs','results'])requireTransition(state[key].length===0,`Données Séries existantes à préserver : ${key}.`);
}
export function validateFinalStandings(data,state,season){
 const games=state.publication?.evidence?.games;
 requireTransition(Array.isArray(games)&&games.length>0,'Preuve des matchs réguliers finaux absente.');
 const records=new Map();
 for(const g of games){
  requireTransition(g.season===season&&g.season_type==='regular'&&g.final_status==='STATUS_FINAL'&&g.completed===true&&[g.home_score,g.away_score].every(s=>Number.isInteger(s)&&s>=0),'Preuve régulière finale incompatible.');
  for(const side of ['home','away']){
   const team=g[`${side}_team`],other=side==='home'?'away':'home',record=records.get(team)||{wins:0,losses:0,ties:0};
   record[g[`${side}_score`]===g[`${other}_score`]?'ties':g[`${side}_score`]>g[`${other}_score`]?'wins':'losses']++;records.set(team,record);
  }
 }
 const entries=[];function walk(node){entries.push(...(node.standings?.entries||node.entries||[]));for(const child of node.children||[])walk(child);}walk(data);
 const abbr=v=>String(v||'').toUpperCase().replace(/^WSH$/,'WAS');const seen=new Set();
 for(const e of entries){
  const teams=state.regular.teams.filter(t=>abbr(t.espn_abbr)&&abbr(t.espn_abbr)===abbr(e.team?.abbreviation));
  requireTransition(teams.length===1,'Équipe du classement ESPN absente ou ambiguë.');const name=teams[0].name;
  requireTransition(records.has(name)&&!seen.has(name),`Classement ESPN incomplet/dupliqué : ${name}.`);seen.add(name);
  for(const key of ['wins','losses','ties']){
   const value=e.stats?.find(s=>s.name===key)?.value;
   requireTransition(Number.isInteger(value)&&value===records.get(name)[key],`Bilan ESPN non final ou incompatible avec la publication : ${name}, ${key}.`);
  }
 }
 requireTransition(seen.size===records.size,'Le classement ESPN ne couvre pas tout le calendrier régulier certifié.');
}
export async function prepareTransition(state,{season,revision,fetcher=fetch,now=Date.now()}={}){
 checkContext(state,season,revision);checkConflicts(state);
 const data=await fetchEspnStandings({season,fetcher,cache:'no-store',signal:AbortSignal.timeout(15000)});
 validateFinalStandings(data,state,season);
 const seeds=extractEspnSeeds(data,season,state.regular.teams);
 if(state.seeds.length){
  validateSeedRows(state.seeds,season);
  requireTransition(JSON.stringify(identity(state.seeds))===JSON.stringify(identity(seeds)),'Seeds existants différents des standings finaux ESPN : révision explicite nécessaire, aucun remplacement automatique.');
 }
 const expected=['AFC','NFC'].flatMap(conference=>[[2,7],[3,6],[4,5]].map(([h,a])=>({home_team:seeds.find(s=>s.conference===conference&&s.seed===h).team,away_team:seeds.find(s=>s.conference===conference&&s.seed===a).team})));
 // Keep the existing official matchup resolver, with a strict six-event envelope.
 const strictFetcher=async(url,options)=>{
  const response=await fetcher(url,options);if(!response.ok)return response;const schedule=await response.json();
  requireTransition(Array.isArray(schedule.events)&&schedule.events.length===6,'Wild Card ESPN doit contenir exactement six événements officiels.');
  return {ok:true,json:async()=>schedule};
 };
 const games=await discoverGames({season,key:'wild_card',expected,seeds,teams:state.regular.teams,fetcher:strictFetcher,now});
 assertMatchups(games,expected,'wild_card');
 return {version:1,season,revision,prepared_at:new Date(now).toISOString(),publication_published_at:state.publication.published_at,seeds:identity(seeds),games};
}
