import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCalendar,regularPoolEligible} from './calendar.mjs';
const prefix='https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
function fixture(futureTbd=false){
 const event={id:'123',season:{year:2027,type:2},week:{number:1},competitions:[{date:'2200-09-01T20:00:00Z',timeValid:true,status:{type:{state:'pre',completed:false}},competitors:[{homeAway:'home',team:{abbreviation:'WSH'}},{homeAway:'away',team:{abbreviation:'BUF'}}]}]};
 const events=[event];
 if(futureTbd){const later=structuredClone(event);later.id='124';later.week.number=18;later.competitions[0].timeValid=false;events.push(later);}
 return {event,fetcher:async url=>{
  const u=new URL(url),week=Number(u.searchParams.get('week'));
  const weekly=u.pathname.match(/weeks\/(\d+)\/events$/);
  const refs=u.pathname.endsWith('/weeks')?events.map(e=>prefix+`/seasons/2027/types/2/weeks/${e.week.number}`):events.filter(e=>!weekly||e.week.number===Number(weekly[1])).map(e=>prefix+'/events/'+e.id);
  return {ok:true,json:async()=>u.hostname==='site.api.espn.com'?{season:{year:2027,type:2},week:{number:week},events:events.filter(e=>e.week.number===week)}:{count:refs.length,pageCount:1,pageIndex:1,pageSize:100,items:refs.map($ref=>({$ref}))}};
 }};
}
const teams=[{name:'Commanders',espn_abbr:'WAS'},{name:'Bills',espn_abbr:'BUF'}];
test('calendar prepares without participants, using complete indexes and actual WSH mapping',async()=>{const f=fixture(),p=await prepareCalendar(2027,teams,f.fetcher);assert.equal(p.games.length,1);assert.equal(p.games[0].home_team,'Commanders');assert.equal(p.games[0].week,1);});
for(const [name,change] of [['started',e=>e.competitions[0].status.type.state='in'],['past kickoff',e=>e.competitions[0].date='2020-01-01'],['wrong season',e=>e.season.year=2026],['unknown team',e=>e.competitions[0].competitors[0].team.abbreviation='???']])test('calendar refuses '+name,async()=>{const f=fixture();change(f.event);await assert.rejects(prepareCalendar(2027,teams,f.fetcher));});

test('regular eligibility preserves Sunday afternoon exclusion in Toronto, including UTC rollover',()=>{
 for(const [date,eligible] of [['2026-09-27T17:00:00Z',false],['2026-09-27T20:25:00Z',false],['2026-09-27T13:30:00Z',true],['2026-09-28T00:20:00Z',true],['2026-09-25T00:20:00Z',true],['2026-09-29T00:20:00Z',true]])assert.equal(regularPoolEligible(date),eligible,date);
});

test('later ESPN provisional times do not block preseason preparation, but week one must be usable',async()=>{
 const f=fixture(true);assert.equal((await prepareCalendar(2027,teams,f.fetcher)).games.length,2);
 f.event.competitions[0].timeValid=false;await assert.rejects(prepareCalendar(2027,teams,f.fetcher));
});
