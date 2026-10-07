import {prepareTransition,TransitionError} from './prepare.mjs';
export async function transitionToPlayoffs(client,{season,revision,actor},fetcher=fetch){
 const {data:state,error}=await client.rpc('lifecycle_transition_state',{p_season:season});if(error)throw new TransitionError('Contexte de transition indisponible. Vérifie les migrations installées.');
 const prepared=await prepareTransition(state,{season,revision,fetcher});
 const result=await client.rpc('transition_to_playoffs',{p_season:season,p_revision:revision,p_actor:actor,p_expected:state,p_prepared:prepared});
 if(result.error)throw new TransitionError(result.error.message);
 return result.data;
}
