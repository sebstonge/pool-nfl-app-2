import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFinalPublication,calculateFinalScores} from './prepare.mjs';
import {collection} from './espn.mjs';
import {fixture} from './fixtures.mjs';
const prepare=f=>prepareFinalPublication(f.state,{fetcher:f.fetcher});
test('complete paginated calendar, FINAL ratings, WSH mapping and exact-spread scoring',async()=>{
 const f=fixture();f.events[0].competitions[0].competitors[0].team.abbreviation='WSH';const p=await prepare(f);
 assert.equal(p.games.length,2);assert.deepEqual(p.results.map(r=>[r.base_points,r.multiplier,r.final_score]),[[2,1,2],[2,1,2]]);
 assert.ok(f.calls.every(u=>!u.includes('supabase')));assert.equal(p.calendar.weeks.length,2);
});
for(const [name,mutate] of [
 ['missing imported event',f=>f.state.games.pop()],
 ['duplicate local event',f=>f.state.games[1].external_game_id=f.state.games[0].external_game_id],
 ['wrong local type',f=>f.state.games[0].season_type='postseason'],
 ['wrong local week',f=>f.state.games[0].week=3],
 ['wrong ESPN season',f=>f.events[0].season.year=2025],
 ['cancelled game is not FINAL',f=>f.events[0].competitions[0].status.type.name='STATUS_CANCELED'],
 ['non FINAL game',f=>f.events[0].status.type.completed=false],
 ['summary live QB rating',f=>f.summaries['101'].header.competitions[0].status.type.state='in'],
 ['missing QB rating',f=>f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats=['']],
 ['nonnumeric QB rating',f=>f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats=['--']],
 ['wrong summary game',f=>f.summaries['101'].header.id='999'],
 ['inconsistent summary final score',f=>f.summaries['101'].header.competitions[0].competitors[0].score='24'],
 ['missing QB choice',f=>f.state.qb_picks=[]],
 ['mixed-season pick',f=>f.state.picks[0].game_id='other-season'],
 ['closed phase',f=>f.state.settings.phase='playoffs'],
 ['finalized regular',f=>f.state.settings.regular_finalized_at='2026-01-01T00:00:00Z'],
])test(`refuse ${name}`,async()=>{const f=fixture();mutate(f);await assert.rejects(prepare(f));});
test('missing week in index cannot hide the season event',async()=>{
 const f=fixture(),original=f.fetcher;f.fetcher=async url=>{const r=await original(url);if(new URL(url).pathname.endsWith('/weeks')){const d=await r.json();d.items.pop();d.count=1;return {...r,json:async()=>d};}return r;};await assert.rejects(prepare(f),/Union/);
});
test('partial scoreboard is refused',async()=>{const f=fixture(),orig=f.fetcher;f.fetcher=async url=>{const r=await orig(url),d=await r.json();if(url.includes('/scoreboard'))d.events=[];return {...r,json:async()=>d};};await assert.rejects(prepare(f),/partiel/);});
test('pagination traverses all pages and refuses a truncated page',async()=>{
 let bad=false;const fetcher=async url=>{const page=Number(new URL(url).searchParams.get('page'));return {ok:true,json:async()=>({count:3,pageCount:2,pageIndex:page,pageSize:2,items:(page===1?[1,2]:bad?[]:[3]).map(n=>({$ref:`https://sports.core.api.espn.com/events/${n}`}))})};};
 assert.deepEqual(await collection('/x',/^\/events\/(\d+)$/,fetcher),['1','2','3']);bad=true;await assert.rejects(collection('/x',/^\/events\/(\d+)$/,fetcher),/partielle/);
});
test('local scores are corrected from final evidence, replacement uses regular first-passer rule',async()=>{
 const f=fixture();f.state.games[0].home_score=999;const a=f.summaries['101'].boxscore.players[0].statistics[0].athletes[0];a.athlete={id:'98',displayName:'Replacement'};a.stats=['125.5'];
 const p=await prepare(f);assert.equal(p.games[0].home_score,21);assert.equal(p.ratings[0].actual_espn_athlete_id,'98');assert.equal(p.results[0].final_score,2.51);
});
test('numeric zero preserves regular sports rule; missing rating cannot fallback',async()=>{
 const f=fixture();f.summaries['101'].boxscore.players[0].statistics[0].athletes[0].stats=['0'];const p=await prepare(f);assert.equal(p.results[0].multiplier,1);assert.throws(()=>calculateFinalScores(f.state,[],p.games),/absent/);
});
test('win, exact spread, loss and tie retain existing regular scoring',async()=>{
 const f=fixture(),p=await prepare(f);f.state.picks[0].predicted_spread=3;f.state.picks[1].picked_team='Buffalo Bills';assert.deepEqual(calculateFinalScores(f.state,p.ratings,p.games).map(r=>r.base_points),[1,0]);p.games[0].home_score=14;assert.equal(calculateFinalScores(f.state,p.ratings,p.games)[0].base_points,0);
});
