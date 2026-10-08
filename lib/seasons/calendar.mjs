import {collection,json,mapBounded,sameIds,ensure} from '../regular-publication/espn.mjs';
// Existing regular import rule: all games except Sunday afternoon (12:00–18:59).
// The server fixes Toronto time instead of inheriting a browser/server timezone.
export function regularPoolEligible(date){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(date)).map(p=>[p.type,p.value]));
 return parts.weekday!=='Sun'||Number(parts.hour)<12||Number(parts.hour)>=19;
}
// Same ESPN indexes/pagination as final publication, but require an unstarted calendar.
export async function prepareCalendar(season,teams,fetcher=fetch){
 const root=`/seasons/${season}/types/2`,eventPattern=/^\/v2\/sports\/football\/leagues\/nfl\/events\/(\d+)$/;
 const weekPattern=new RegExp(`^/v2/sports/football/leagues/nfl/seasons/${season}/types/2/weeks/(\\d+)$`);
 const weeks=await collection(root+'/weeks',weekPattern,fetcher),ids=await collection(root+'/events',eventPattern,fetcher);
 ensure(weeks.includes('1'),'Semaine 1 absente.');
 const games=(await mapBounded(weeks,async w=>{
  const expected=await collection(`${root}/weeks/${w}/events`,eventPattern,fetcher);
  const d=await json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${w}&limit=${expected.length+1}`,fetcher);
  ensure(d.season?.year===season&&d.season?.type===2&&d.week?.number===Number(w)&&sameIds((d.events||[]).map(e=>String(e.id)),expected),'Calendrier ESPN incomplet.');
  return d.events.map(e=>{
   const c=e.competitions?.[0];ensure(e.competitions?.length===1&&e.season?.year===season&&e.season?.type===2&&e.week?.number===Number(w)&&c.status?.type?.state==='pre'&&c.status?.type?.completed===false&&(Number(w)!==1||(c.timeValid!==false&&c.dateValid!==false))&&Date.parse(c.date||e.date)>Date.now(),'Match non confirmé ou commencé.');
   const g={external_game_id:String(e.id),week:Number(w),game_date:c.date||e.date};
   for(const side of ['home','away']){const rows=c.competitors?.filter(x=>x.homeAway===side);ensure(rows?.length===1,'Orientation invalide.');const abbr=String(rows[0].team?.abbreviation).toUpperCase().replace(/^WSH$/,'WAS');const found=teams.filter(t=>String(t.espn_abbr).toUpperCase().replace(/^WSH$/,'WAS')===abbr);ensure(found.length===1,'Équipe ESPN ambiguë.');g[`${side}_team`]=found[0].name;}
   g.is_pool_eligible=regularPoolEligible(g.game_date);
   return g;
  });
 })).flat();
 ensure(sameIds(games.map(g=>g.external_game_id),ids)&&sameIds(await collection(root+'/events',eventPattern,fetcher),ids)&&sameIds(await collection(root+'/weeks',weekPattern,fetcher),weeks),'Calendrier modifié pendant la préparation.');
 return {games};
}
