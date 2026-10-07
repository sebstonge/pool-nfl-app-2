import { loadLifecycle } from '../lifecycle/context.mjs';
import { scoringState } from './scoringOperations.mjs';
import { ROUNDS, RoundError, expectedMatchups } from './rounds.mjs';
import { discoverGames } from './roundEspn.mjs';

// ESPN PREPARE only. The RPC revalidates this exact snapshot and commits both steps.
export async function advanceRound(client,{season,roundKey,actor},fetcher=fetch) {
 const index=ROUNDS.findIndex(r=>r.key===roundKey);
 if(index<0||index===3)throw new RoundError('Aucune ronde suivante après le Super Bowl.');
 const context=await loadLifecycle(client);
 if(context.phase!=='playoffs'||context.current_season!==season)throw new RoundError('Saison Séries active requise.');
 const scoring=await scoringState(client,season);
 const source=scoring.rounds.find(r=>r.round_key===roundKey);
 if(!source)throw new RoundError('Ronde source absente.');
 const {data:receipt,error:readError}=await client.from('playoff_round_advances').select('source_round_id').eq('source_round_id',source.id).maybeSingle();
 if(readError)throw new RoundError('Lecture du reçu d’avancement impossible.');
 let games=[];
 if(!receipt){
  if(source.status!=='scored')throw new RoundError('La ronde doit être calculée avant de poursuivre.');
  const key=ROUNDS[index+1].key;
  const expected=expectedMatchups(scoring.seeds,season,key,scoring.rounds,scoring.games);
  games=await discoverGames({season,key,expected,seeds:scoring.seeds,teams:scoring.teams,fetcher});
 }
 const {error}=await client.rpc('advance_playoff_round_atomic',{p_season:season,p_round_key:roundKey,p_actor:actor,p_expected:{context,scoring},p_games:games});
 if(error)throw new RoundError(`Avancement refusé, aucune écriture partielle : ${error.message}`);
 return {message:'Ronde finalisée et ronde suivante ouverte. Aucun double avancement.'};
}
