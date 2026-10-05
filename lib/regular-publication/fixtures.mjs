// Synthetic local fixtures only; never sent to ESPN or Supabase.
export const user='00000000-0000-0000-0000-000000000001';
export const qb='00000000-0000-0000-0000-000000000002';
export const gameId=n=>`00000000-0000-0000-0000-${String(n+10).padStart(12,'0')}`;
export function fixture(){
 const status={type:{name:'STATUS_FINAL',state:'post',completed:true}};
 const events=[1,2].map(week=>({id:String(100+week),season:{year:2026,type:2},week:{number:week},status:structuredClone(status),competitions:[{status:structuredClone(status),competitors:[{homeAway:'home',team:{id:'1',abbreviation:'WAS'},score:'21'},{homeAway:'away',team:{id:'2',abbreviation:'BUF'},score:'14'}]}]}));
 const state={settings:{id:1,current_season:2026,current_week:5,revision:0,phase:'regular',regular_finalized_at:null,playoff_reminders_enabled:false},teams:[{name:'Washington Commanders',espn_abbr:'WAS'},{name:'Buffalo Bills',espn_abbr:'BUF'}],qbs:[{id:qb,name:'Selected QB',team:'Commanders',espn_athlete_id:'99'}],games:events.map((e,i)=>({id:gameId(i),external_game_id:e.id,season:2026,season_type:'regular',week:i+1,home_team:'Washington Commanders',away_team:'Buffalo Bills',home_score:null,away_score:null})),picks:events.map((e,i)=>({user_id:user,game_id:gameId(i),picked_team:'Washington Commanders',predicted_spread:7})),qb_picks:events.map((e,i)=>({user_id:user,qb_id:qb,week:i+1})),qb_ratings:[],weekly_scores:[]};
 const summaries=Object.fromEntries(events.map(e=>[e.id,{
  header:{id:e.id,season:e.season,competitions:structuredClone(e.competitions)},
  boxscore:{players:[{team:{id:'1'},statistics:[{
   name:'passing',labels:['RTG'],athletes:[{athlete:{id:'99',displayName:'Selected QB'},stats:['100.0']}]
  }]}]}
 }]));
 const calls=[];
 const fetcher=async url=>{
  calls.push(url);const u=new URL(url);let data;
  if(u.hostname==='sports.core.api.espn.com'){
   let refs;
   if(u.pathname.endsWith('/weeks')) refs=[1,2].map(n=>`/seasons/2026/types/2/weeks/${n}`);
   else {const week=u.pathname.match(/weeks\/(\d+)\/events$/)?.[1];refs=events.filter(e=>!week||e.week.number===Number(week)).map(e=>`/events/${e.id}`);}
   data={count:refs.length,pageIndex:1,pageSize:100,pageCount:1,items:refs.map(p=>({$ref:'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl'+p}))};
  }else if(u.pathname.endsWith('/scoreboard')){const week=Number(u.searchParams.get('week'));data={season:{year:2026,type:2},week:{number:week},events:events.filter(e=>e.week.number===week)};}
  else data=summaries[u.searchParams.get('event')];
  return {ok:true,json:async()=>structuredClone(data)};
 };
 return {state,events,summaries,calls,fetcher};
}
