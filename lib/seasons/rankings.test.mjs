import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rankWeeklyScores,rankSeasonScores} from './rankings.mjs';

const scores=[
  {user_id:'beta',week:1,season:2026,final_score:2.5},
  {user_id:'alpha',week:'1',season:2026,final_score:'2.500'},
  {user_id:'zero',week:1,season:2026,final_score:0},
  {user_id:'empty',week:1,season:2026,final_score:null},
  {user_id:'alpha',week:2,season:2026,final_score:1.25},
  {user_id:'beta',week:2,season:2026,final_score:1.25},
  {user_id:'zero',week:2,season:2026,final_score:2},
  {user_id:'future',week:3,season:2026,final_score:99},
  {user_id:'archive',week:1,season:2025,final_score:100},
];
const current=scores.filter(row=>row.season===2026);

test('weekly scores retain zero and numeric strings and use ordinal ranks for stable ties',()=>{
  assert.deepEqual(rankWeeklyScores(current,'1'),[
    {userId:'beta',rank:1,score:2.5,diff:0},
    {userId:'alpha',rank:2,score:2.5,diff:0},
    {userId:'zero',rank:3,score:0,diff:2.5},
    {userId:'empty',rank:4,score:0,diff:2.5},
  ]);
  const reversed=[...current].reverse();
  assert.deepEqual(rankWeeklyScores(reversed,1).map(row=>row.userId),['alpha','beta','empty','zero']);
});

test('season totals include every supplied row and preserve first occurrence for ties',()=>{
  const throughTwo=current.filter(row=>Number(row.week)<=2);
  assert.deepEqual(rankSeasonScores(throughTwo),[
    {userId:'beta',total:3.75,weeks:2},
    {userId:'alpha',total:3.75,weeks:2},
    {userId:'zero',total:2,weeks:2},
    {userId:'empty',total:0,weeks:1},
  ]);
  assert.deepEqual(rankSeasonScores([...throughTwo].reverse()).slice(0,2).map(row=>row.userId),['beta','alpha']);
  assert.equal(rankSeasonScores(current)[0].userId,'future');
  assert.equal(rankSeasonScores(scores)[0].userId,'archive');
});

test('filtering the target season and cumulative cutoff remains the callers responsibility',()=>{
  const forWeek=week=>scores.filter(row=>row.season===2026&&Number(row.week)<=week);
  assert.deepEqual(rankSeasonScores(forWeek(1)).map(row=>[row.userId,row.total,row.weeks]),[
    ['beta',2.5,1],['alpha',2.5,1],['zero',0,1],['empty',0,1],
  ]);
  assert.equal(rankSeasonScores(forWeek(2)).find(row=>row.userId==='alpha').total,3.75);
  assert.equal(rankSeasonScores(forWeek(2)).some(row=>row.userId==='future'||row.userId==='archive'),false);
  // Weekly filtering selects the week only, exactly as on the existing page.
  assert.equal(rankWeeklyScores(scores,1)[0].userId,'archive');
});

test('existing Object.values ordering for numeric user IDs is preserved at equal season totals',()=>{
  const numeric=[{user_id:'10',week:1,final_score:1},{user_id:'2',week:1,final_score:1}];
  assert.deepEqual(rankSeasonScores(numeric).map(row=>row.userId),['2','10']);
  assert.deepEqual(rankWeeklyScores(numeric,1).map(row=>row.userId),['10','2']);
});

test('inputs and their order are not mutated, and outputs contain independent objects',()=>{
  const frozen=Object.freeze(current.map(row=>Object.freeze({...row})));
  const before=JSON.stringify(frozen);
  const weekly=rankWeeklyScores(frozen,1),season=rankSeasonScores(frozen);
  weekly[0].score=1000;season[0].total=1000;
  assert.equal(JSON.stringify(frozen),before);
  assert.equal(rankWeeklyScores(frozen,1)[0].score,2.5);
  assert.equal(rankSeasonScores(frozen)[0].total,99);
});

test('empty scores remain empty and a zero leader has a real zero difference',()=>{
  assert.deepEqual(rankWeeklyScores([],1),[]);assert.deepEqual(rankSeasonScores([]),[]);
  assert.deepEqual(rankSeasonScores(null),[]);
  assert.deepEqual(rankWeeklyScores([{user_id:'zero',week:1,final_score:0}],1),[{userId:'zero',rank:1,score:0,diff:0}]);
});

test('the rankings page wrappers preserve display names, real names and fallback identities',async()=>{
  const page=await readFile(new URL('../../app/classements/RegularPage.js',import.meta.url),'utf8');
  const weeklyStart=page.indexOf('  function buildWeeklyRows(');
  const weeklyEnd=page.indexOf('  /* =========================================================\n     DONNÉES',weeklyStart);
  const seasonStart=page.indexOf('      function buildSeasonRows(scores) {');
  const seasonEnd=page.indexOf('      const seasonRows =',seasonStart);
  assert.ok(weeklyStart>=0&&weeklyEnd>weeklyStart&&seasonStart>=0&&seasonEnd>seasonStart);
  const users=[{id:'beta',display_name:'Pool Beta',real_name:'Béatrice'},{id:'alpha',email:'alpha@example.com',real_name:'Alex'}];
  const displayName=(user,id)=>user?.display_name||user?.email?.split('@')[0]||id;
  const realName=user=>user?.real_name||'';
  const wrappers=new Function('rankWeeklyScores','rankSeasonScores','displayName','realName','getUser',page.slice(weeklyStart,weeklyEnd)+page.slice(seasonStart,seasonEnd)+';return {buildWeeklyRows,buildSeasonRows};')(
    rankWeeklyScores,rankSeasonScores,displayName,realName,id=>users.find(user=>user.id===id),
  );
  assert.deepEqual(wrappers.buildWeeklyRows(current,users,1),rankWeeklyScores(current,1).map(row=>({...row,name:displayName(users.find(user=>user.id===row.userId),row.userId),realName:realName(users.find(user=>user.id===row.userId))})));
  assert.deepEqual(wrappers.buildSeasonRows(current),rankSeasonScores(current).map(row=>({...row,name:displayName(users.find(user=>user.id===row.userId),row.userId),realName:realName(users.find(user=>user.id===row.userId))})));
});
