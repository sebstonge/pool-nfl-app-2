import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEspnWeek} from '../regular-admin/espnWeek.mjs';

const teams=[
 {id:'eagles',name:'Philadelphia Eagles',espn_abbr:'PHI'},
 {id:'cowboys',name:'Dallas Cowboys',espn_abbr:'DAL'},
];
const pick=(week,name,id)=>({qb_id:'row',week,season:2026,selected_qb_name:name,selected_espn_athlete_id:id,selected_team:'Eagles',
 qbs:{id:'row',name:'Current different QB',espn_athlete_id:'99',team:'Other team'}});
function prepare(choice,passers,requests=[]){
 const game={id:'game',season:2026,week:choice.week,season_type:'regular',is_pool_eligible:true,
  home_team:teams[0].name,away_team:teams[1].name,external_game_id:'123'};
 const body={header:{id:'123',season:{year:2026,type:2},week:{number:choice.week},competitions:[{
  status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},
  competitors:[{homeAway:'home',score:'24',team:{id:'1',abbreviation:'PHI'}},
   {homeAway:'away',score:'17',team:{id:'2',abbreviation:'DAL'}}],
 }]},boxscore:{players:[{team:{id:'1'},statistics:[{name:'passing',labels:['RTG'],
  athletes:passers.map(p=>({athlete:{id:p.id,displayName:p.name},stats:[String(p.rating)]})),
 }]}]}};
 const state={settings:{current_season:2026,current_week:choice.week},games:[game],qb_picks:[choice],qb_ratings:[]};
 return prepareEspnWeek(state,{mode:'manual',teams,fetcher:async url=>{
  requests.push(url);return {ok:true,json:async()=>body};
 }});
}
for(const [week,name,id,passers,actual,value] of [
 [2,'Jalen Hurts','1',[{id:'1',name:'Jalen Hurts',rating:85.9}],'1',85.9],
 [6,'Jalen Hurts','1',[{id:'2',name:'Tanner McKee',rating:104.7}],'2',104.7],
 [7,'Tanner McKee','2',[{id:'2',name:'Tanner McKee',rating:99.1}],'2',99.1],
])test(`Admin week ${week} prepares the official passer from the frozen snapshot`,async()=>{
 const requests=[];
 const result=await prepare(pick(week,name,id),passers,requests);
 assert.equal(result.ratings.length,1);assert.equal(requests.length,1);
 assert.equal(result.ratings[0].qb_id,'row');
 assert.equal(result.ratings[0].actual_espn_athlete_id,actual);
 assert.equal(result.ratings[0].passer_rating,value);
});
test('Admin never guesses a missing selected identity from the current catalogue',async()=>{
 const result=await prepare({qb_id:'old',week:2,qbs:{name:'Current QB',team:'Eagles',espn_athlete_id:'9'}},[]);
 assert.deepEqual(result.ratings,[]);assert.match(result.warnings[0],/identité ou match du QB absent/);
});
