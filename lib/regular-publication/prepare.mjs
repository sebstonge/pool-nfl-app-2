import {ensure,finalCalendar,finalSummary,sameIds,mapBounded} from './espn.mjs';
import {selectRegularPasser} from '../playoffs/qbResults.mjs';
import {validateLifecycle,regularIsOpen} from '../lifecycle/context.mjs';
export function calculateFinalScores(state,ratings,games){
 const totals=new Map(),byId=new Map(games.map(g=>[g.id,g]));
 for(const p of state.picks){
  const g=byId.get(p.game_id);ensure(g&&[g.home_team,g.away_team].includes(p.picked_team)&&Number.isInteger(p.predicted_spread)&&p.predicted_spread>=0,'Choix régulier invalide.');
  const key=`${p.user_id}:${g.week}`,row=totals.get(key)||{user_id:p.user_id,week:g.week,base_points:0};
  const winner=g.home_score===g.away_score?null:g.home_score>g.away_score?g.home_team:g.away_team;
  row.base_points+=p.picked_team===winner?(p.predicted_spread===Math.abs(g.home_score-g.away_score)?2:1):0;totals.set(key,row);
 }
 ensure(totals.size>0,'Aucun résultat du pool à certifier.');
 return [...totals.values()].map(r=>{
  const choices=state.qb_picks.filter(q=>q.user_id===r.user_id&&q.week===r.week);ensure(choices.length===1,'Choix QB nécessaire absent ou ambigu.');
  const rating=ratings.find(q=>q.qb_id===choices[0].qb_id&&q.week===r.week);
  ensure(rating&&Number.isFinite(rating.passer_rating)&&rating.passer_rating>=0&&rating.passer_rating<=158.3,'Rating QB final nécessaire absent.');
  // Preserve the existing regular rule for a real numeric zero, never missing data.
  const m=rating.passer_rating>0?rating.passer_rating/100:1;
  return {...r,multiplier:Number(m.toFixed(3)),final_score:Number((r.base_points*m).toFixed(3))};
 }).sort((a,b)=>a.week-b.week||a.user_id.localeCompare(b.user_id));
}
export async function prepareFinalPublication(state,{fetcher=fetch}={}){
 const context=validateLifecycle(state.settings);ensure(regularIsOpen(context),'Saison régulière fermée.');
 const season=context.current_season,calendar=await finalCalendar(season,state.teams,fetcher);
 ensure(state.games.every(g=>g.season===season&&g.season_type==='regular'),'Match local de mauvais type/saison.');
 ensure(sameIds(state.games.map(g=>g.external_game_id),calendar.event_ids),'Import local incomplet ou dupliqué.');
 const games=calendar.games.map(e=>{
  const found=state.games.filter(g=>g.external_game_id===e.external_game_id);ensure(found.length===1,'Événement local dupliqué.');const g=found[0];
  ensure(g.week===e.week&&g.home_team===e.home_team&&g.away_team===e.away_team,'Match local incompatible avec ESPN.');return {...e,id:g.id};
 });
 const needed=new Map();for(const p of state.picks){const g=games.find(g=>g.id===p.game_id);ensure(g,'Choix hors saison active.');const q=state.qb_picks.filter(q=>q.user_id===p.user_id&&q.week===g.week);ensure(q.length===1,'Choix QB nécessaire absent.');needed.set(`${q[0].qb_id}:${g.week}`,q[0]);}
 const summaries=new Map();
 const ratings=await mapBounded([...needed.values()],async choice=>{
  const qb=state.qbs.find(q=>q.id===choice.qb_id);ensure(qb?.team&&qb.name,'Identité QB absente.');
  const matches=games.filter(g=>g.week===choice.week&&[g.home_team,g.away_team].some(t=>t.toLowerCase().includes(qb.team.toLowerCase())));
  ensure(matches.length===1,'Match du QB absent ou ambigu.');const game=matches[0];
  const sides=['home','away'].filter(side=>game[`${side}_team`].toLowerCase().includes(qb.team.toLowerCase()));ensure(sides.length===1,'Équipe QB ambiguë.');const side=sides[0];
  if(!summaries.has(game.id))summaries.set(game.id,finalSummary(game,fetcher));
  const boxes=(await summaries.get(game.id)).boxscore?.players?.filter(t=>String(t.team?.id)===game[`${side}_espn_id`]);ensure(boxes?.length===1,'Boxscore QB absent/ambigu.');
  const category=boxes[0].statistics?.find(c=>c.name==='passing'||c.displayName==='Passing');
  const index=(category?.labels||[]).findIndex(l=>['RTG','RAT','RATE'].includes(String(l).toUpperCase()));ensure(index>=0&&category?.athletes?.length,'Rating QB absent.');
  const passers=category.athletes.map(row=>{
   const raw=row.stats?.[index];ensure(raw!=null&&String(raw).trim()!==''&&Number.isFinite(Number(raw))&&Number(raw)>=0&&Number(raw)<=158.3&&/^\d+$/.test(String(row.athlete?.id))&&row.athlete?.displayName,'Rating QB incomplet.');
   return {id:String(row.athlete.id),name:row.athlete.displayName,rating:Number(raw)};
  });
  const {actual}=selectRegularPasser(qb,passers);
  return {qb_id:qb.id,week:choice.week,game_id:game.id,team:game[`${side}_team`],state:'post',completed:true,final_status:'STATUS_FINAL',passers,passer_rating:actual.rating,actual_qb_name:actual.name,actual_espn_athlete_id:actual.id};
 });
 ratings.sort((a,b)=>a.week-b.week||a.qb_id.localeCompare(b.qb_id));
 return {version:1,season,revision:context.revision,calendar:{...calendar,games:undefined},games,ratings,results:calculateFinalScores(state,ratings,games)};
}
