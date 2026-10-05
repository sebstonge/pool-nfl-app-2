const CORE='https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const SITE='https://site.api.espn.com/apis/site/v2/sports/football/nfl';
export class PublicationError extends Error {}
export function ensure(ok,message){if(!ok)throw new PublicationError(message);}
export async function json(url,fetcher){
 const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 ensure(response.ok,`ESPN indisponible (${response.status}).`);return response.json();
}
// Only server-built URLs are requested, never arbitrary provider $ref URLs.
export async function collection(path,pattern,fetcher){
 let total,pages;const ids=[];
 for(let page=1;page<=(pages??1);page++){
  const d=await json(`${CORE}${path}?limit=100&page=${page}`,fetcher);
  ensure(Number.isInteger(d.count)&&d.count>0&&Number.isInteger(d.pageCount)&&d.pageCount>0&&d.pageCount<=1000&&d.pageIndex===page&&Number.isInteger(d.pageSize)&&d.pageSize>0&&Array.isArray(d.items),'Pagination ESPN invalide.');
  ensure(d.pageCount===Math.ceil(d.count/d.pageSize)&&d.items.length===(page<d.pageCount?d.pageSize:d.count-(page-1)*d.pageSize),'Page ESPN partielle.');
  if(page===1){total=d.count;pages=d.pageCount;}else ensure(d.count===total&&d.pageCount===pages,'Calendrier ESPN modifié pendant la lecture.');
  for(const item of d.items){const ref=new URL(item.$ref);ensure(ref.hostname==='sports.core.api.espn.com','Référence ESPN invalide.');const match=ref.pathname.match(pattern);ensure(match,'Référence calendrier incohérente.');ids.push(match[1]);}
 }
 ensure(ids.length===total&&new Set(ids).size===ids.length,'Événement/semaine absent ou dupliqué.');return ids.sort((a,b)=>Number(a)-Number(b));
}
export const sameIds=(a,b)=>a.length===b.length&&[...a].sort().every((x,i)=>x===[...b].sort()[i]);
const abbr=x=>String(x||'').toUpperCase().replace(/^WSH$/,'WAS');
export function finalEvent(event,season,week,teams){
 ensure(/^\d+$/.test(String(event.id))&&event.season?.year===season&&event.season?.type===2&&event.week?.number===week,'Identité saison/type/semaine ESPN incohérente.');
 ensure(event.competitions?.length===1,'Compétition ESPN ambiguë.');const c=event.competitions[0];
 ensure(c.status?.type?.name==='STATUS_FINAL'&&event.status?.type?.name==='STATUS_FINAL'&&c.status?.type?.state==='post'&&c.status?.type?.completed===true&&event.status?.type?.state==='post'&&event.status?.type?.completed===true,'Match régulier non FINAL.');
 ensure(c.competitors?.length===2,'Équipes incomplètes.');
 const out={external_game_id:String(event.id),week,season,season_type:'regular',state:'post',completed:true,final_status:'STATUS_FINAL'};
 for(const side of ['home','away']){
  const competitors=c.competitors.filter(x=>x.homeAway===side);ensure(competitors.length===1,'Orientation ESPN ambiguë.');const r=competitors[0];
  const matches=teams.filter(t=>abbr(t.espn_abbr)&&abbr(t.espn_abbr)===abbr(r.team?.abbreviation));
  ensure(matches.length===1&&/^\d+$/.test(String(r.team?.id)),'Rapprochement teams/ESPN invalide.');
  ensure(r.score!==null&&r.score!==undefined&&String(r.score).trim()!==''&&Number.isInteger(Number(r.score))&&Number(r.score)>=0,'Score final absent.');
  out[`${side}_team`]=matches[0].name;out[`${side}_espn_id`]=String(r.team.id);out[`${side}_score`]=Number(r.score);
 }
 ensure(out.home_team!==out.away_team,'Équipes dupliquées.');return out;
}
// Bound provider load while keeping a full-season preparation practical.
export async function mapBounded(items,operation,limit=4){
 const output=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  for(;;){const i=next++;if(i>=items.length)return;output[i]=await operation(items[i]);}
 }));return output;
}
export async function finalCalendar(season,teams,fetcher=fetch){
 const root=`/seasons/${season}/types/2`;
 const weekPattern=new RegExp(`^/v2/sports/football/leagues/nfl/seasons/${season}/types/2/weeks/(\\d+)$`);
 const eventPattern=/^\/v2\/sports\/football\/leagues\/nfl\/events\/(\d+)$/;
 const weeks=await collection(root+'/weeks',weekPattern,fetcher);
 const ids=await collection(root+'/events',eventPattern,fetcher);
 const loaded=await mapBounded(weeks,async value=>{
  const week=Number(value),expected=await collection(`${root}/weeks/${week}/events`,eventPattern,fetcher);
  const d=await json(`${SITE}/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=${expected.length+1}`,fetcher);
  ensure(d.season?.year===season&&d.season?.type===2&&d.week?.number===week&&Array.isArray(d.events),'Scoreboard saison/semaine invalide.');
  ensure(sameIds(d.events.map(e=>String(e.id)),expected),'Scoreboard partiel ou événement dupliqué.');
  return {games:d.events.map(e=>finalEvent(e,season,week,teams)),week,event_ids:expected};
 });
 const games=loaded.flatMap(w=>w.games),weekly=loaded.map(({week,event_ids})=>({week,event_ids}));
 ensure(sameIds(games.map(g=>g.external_game_id),ids)&&new Set(games.map(g=>g.external_game_id)).size===ids.length,'Union des semaines différente du calendrier ESPN complet.');
 // Re-read both indexes after all reads to detect changes during preparation.
 ensure(sameIds(await collection(root+'/events',eventPattern,fetcher),ids)&&sameIds(await collection(root+'/weeks',weekPattern,fetcher),weeks),'Calendrier changé pendant la préparation.');
 return {version:1,season,season_type:2,weeks:weekly,event_ids:ids,games:games.sort((a,b)=>Number(a.external_game_id)-Number(b.external_game_id))};
}
export async function finalSummary(game,fetcher){
 const summary=await json(`${SITE}/summary?event=${game.external_game_id}`,fetcher),h=summary.header,c=h?.competitions?.[0];
 ensure(String(h?.id)===game.external_game_id&&h?.season?.year===game.season&&h?.season?.type===2&&h.competitions?.length===1&&c?.status?.type?.name==='STATUS_FINAL'&&c?.status?.type?.state==='post'&&c?.status?.type?.completed===true,'Résumé QB non FINAL ou mauvaise saison.');
 for(const side of ['home','away']){const r=c.competitors?.filter(r=>r.homeAway===side);ensure(r?.length===1&&String(r[0].team?.id)===game[`${side}_espn_id`]&&r[0].score!=null&&String(r[0].score).trim()!==''&&Number(r[0].score)===game[`${side}_score`],'Résumé QB incompatible avec le match final.');}
 return summary;
}
