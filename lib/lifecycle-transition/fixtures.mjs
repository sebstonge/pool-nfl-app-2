// Synthetic 2099 season only; never submitted to any remote database.
import {fixtureSeeds,fixtureTeams,fixtureSchedule} from '../playoffs/roundFixtures.mjs';
export const actor='00000000-0000-0000-0000-000000000001';
export const quarterback='00000000-0000-0000-0000-000000000002';
export function transitionFixture(){
 const seeds=fixtureSeeds().map(({season,team,espn_team_id,conference,seed})=>({season,team,espn_team_id,conference,seed}));
 const teams=fixtureTeams();
 const games=Array.from({length:7},(_,i)=>({id:`00000000-0000-0000-0000-${String(100+i).padStart(12,'0')}`,external_game_id:String(1000+i),season:2099,season_type:'regular',week:1,home_team:`AFC${i+1}`,away_team:`NFC${i+1}`,home_score:21,away_score:14,state:'post',completed:true,final_status:'STATUS_FINAL'}));
 const publication={season:2099,lifecycle_revision:0,published_at:'2026-01-01T00:00:00Z',evidence:{games}};
 const state={regular:{settings:{id:1,current_season:2099,current_week:1,phase:'regular',regular_finalized_at:null,revision:0,playoff_reminders_enabled:false},teams},publication,publication_valid:true,seeds:[],rounds:[],games:[],picks:[],qb_picks:[],paths:[],runs:[],results:[]};
 const standings={season:{year:2099},children:['AFC','NFC'].map(conference=>({abbreviation:conference,standings:{entries:seeds.filter(s=>s.conference===conference).map(s=>({team:{id:s.espn_team_id,abbreviation:s.team},stats:[{name:'playoffSeed',value:s.seed},{name:'wins',value:conference==='AFC'?1:0},{name:'losses',value:conference==='AFC'?0:1},{name:'ties',value:0}]}))}}))};
 const pairs=['AFC','NFC'].flatMap(c=>[[2,7],[3,6],[4,5]].map(([h,a])=>({home_team:`${c}${h}`,away_team:`${c}${a}`})));
 const schedule=fixtureSchedule(pairs);const calls=[];
 const fetcher=async url=>{calls.push(url);return {ok:true,json:async()=>structuredClone(url.includes('/standings')?standings:schedule)};};
 return {state,seeds,standings,schedule,fetcher,calls,games};
}
