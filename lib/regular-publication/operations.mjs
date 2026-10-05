import {loadLifecycle,regularIsOpen} from '../lifecycle/context.mjs';
import {ensure} from './espn.mjs';
import {prepareFinalPublication} from './prepare.mjs';
export async function publishFinalRegular(client,{season,revision,actor},fetcher=fetch){
 const context=await loadLifecycle(client);
 ensure(regularIsOpen(context)&&season===context.current_season&&revision===context.revision,'Contexte régulier périmé ou fermé.');
 const {data:state,error}=await client.rpc('regular_publication_state',{p_season:context.current_season});if(error)throw error;
 const proof=await prepareFinalPublication(state,{fetcher});
 const result=await client.rpc('publish_regular_final',{p_season:season,p_revision:revision,p_actor:actor,p_expected:state,p_proof:proof});
 if(result.error)throw result.error;return result.data;
}
