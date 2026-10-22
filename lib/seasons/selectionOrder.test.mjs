import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {regularClient} from './regularClient.mjs';
import {regularOrder,remainingSelectionOrder,historicalRegularOrder,loadRegularOrder,assertRegularTurn} from './selectionOrder.mjs';

const players=[{id:'a',real_name:'Alpha',initial_order:1},{id:'b',real_name:'Bravo',initial_order:2},{id:'c',real_name:'Charlie',initial_order:3}];
const ids=rows=>rows.map(p=>p.id);
const scores=(week,values)=>Object.entries(values).map(([user_id,final_score])=>({week,user_id,final_score}));
const picks=(week,order)=>order.map((user_id,i)=>({week,user_id,created_at:`2026-10-01T12:00:0${i}.000000Z`}));

test('week one preserves initial_order regardless of scores, names or query order',()=>{
  const p=[{...players[0],initial_order:3},{...players[1],initial_order:1},{...players[2],initial_order:2}];
  assert.deepEqual(ids(regularOrder(p.reverse(),1,scores(1,{a:0,b:50,c:100}))),['b','c','a']);
});

test('weekly score is the primary ascending criterion',()=>{
  assert.deepEqual(ids(regularOrder(players,3,[...scores(1,{a:0,b:100,c:1000}),...scores(2,{a:5,b:2,c:1})])),['c','b','a']);
});

test('two players tied at zero: lower cumulative score chooses first',()=>{
  assert.deepEqual(ids(regularOrder(players.slice(0,2),3,[...scores(1,{a:10,b:2}),...scores(2,{a:0,b:0})])),['b','a']);
});

test('multiple zero ties follow cumulative general standing (C then B then A)',()=>{
  assert.deepEqual(ids(regularOrder(players,8,[...scores(1,{a:30,b:10,c:2}),...scores(7,{a:0,b:0,c:0})])),['c','b','a']);
});

test('nonzero weekly ties also use cumulative totals, not the name or initial order',()=>{
  assert.deepEqual(ids(regularOrder(players,3,[...scores(1,{a:9,b:1,c:4}),...scores(2,{a:2,b:2,c:2})])),['b','c','a']);
});

test('weekly AND general tie keeps actual previous-week relative order',()=>{
  const rows=[...scores(1,{a:5,b:5,c:5}),...scores(2,{a:0,b:0,c:0})];
  assert.deepEqual(ids(regularOrder(players,3,rows,picks(2,['c','a','b']))),['c','a','b']);
});

test('without timestamp evidence, reconstruct previous order rather than sort names',()=>{
  const rows=[...scores(1,{a:0,b:2,c:1}),...scores(2,{a:3,b:1,c:2}),...scores(3,{a:0,b:0,c:0})];
  assert.deepEqual(ids(regularOrder(players,4,rows)),['b','c','a']);
});

test('a real zero is valid and precedes missing, NULL, blank, or invalid scores',()=>{
  for (const missing of [undefined,null,'','  ',NaN,'invalid',false]) {
    assert.deepEqual(ids(regularOrder(players,2,scores(1,{a:missing,b:'0',c:2}))),['b','c','a']);
  }
  assert.deepEqual(ids(regularOrder(players,2,scores(1,{b:0,c:2}))),['b','c','a']);
});

test('the general uses final_score and excludes current/future weeks',()=>{
  const rows=[...scores(1,{a:3,b:1,c:2}),...scores(2,{a:0,b:0,c:0}),...scores(3,{a:-100,b:100,c:0})];
  rows[3].total_score=1000;
  assert.deepEqual(ids(regularOrder(players,3,rows)),['b','c','a']);
});

test('similar displayed totals remain distinct; no rounding of stored scores',()=>{
  assert.deepEqual(ids(regularOrder(players.slice(0,2),3,[...scores(1,{a:1.0002,b:1.0001}),...scores(2,{a:0,b:0})],picks(2,['a','b']))),['b','a']);
});

test('decimal cumulative equality does not introduce a floating-point tie-break',()=>{
  const rows=[...scores(1,{a:0.1,b:0.3}),...scores(2,{a:0.2,b:0}),...scores(3,{a:0,b:0})];
  assert.deepEqual(ids(regularOrder(players.slice(0,2),4,rows,picks(3,['a','b']))),['a','b']);
});

test('timestamp precision preserves PostgreSQL microseconds',()=>{
  const history=[{week:2,user_id:'a',created_at:'2026-10-01T12:00:00.123999Z'},{week:2,user_id:'b',created_at:'2026-10-01T12:00:00.123001Z'}];
  assert.deepEqual(ids(regularOrder(players.slice(0,2),3,[...scores(1,{a:0,b:0}),...scores(2,{a:0,b:0})],history)),['b','a']);
});

test('missing or identical timestamps use deterministic initial order then user ID last',()=>{
  const history=[{week:2,user_id:'a',created_at:'invalid'},{week:2,user_id:'b',created_at:null}];
  for (const p of [players,[...players].reverse()]) assert.deepEqual(ids(regularOrder(p,3,[],history)),['a','b','c']);
  const equal=picks(2,['a','b','c']).map(p=>({...p,created_at:'2026-10-01T12:00:00Z'}));
  assert.deepEqual(ids(regularOrder(players,3,[],equal)),['a','b','c']);
  assert.deepEqual(ids(regularOrder([{id:'z'},{id:'a'}],3)),['a','z']);
});

test('inputs are immutable and remaining queue names the same active player',()=>{
  const rows=[...scores(1,{a:10,b:5,c:1}),...scores(2,{a:0,b:0,c:0})],history=picks(2,['b','a','c']);
  const before=structuredClone({players,rows,history});
  const order=regularOrder(players,3,rows,history);
  assert.deepEqual(ids(remainingSelectionOrder(order,[{user_id:'c'}])),['b','a']);
  assert.deepEqual(remainingSelectionOrder(order,players.map(p=>({user_id:p.id}))),[]);
  assert.deepEqual({players,rows,history},before);
});

test('historical timing preserves observed predecessors despite new cumulative tie-breaks',()=>{
  const rows=[...scores(1,{a:10,b:1,c:5}),...scores(2,{a:0,b:0,c:0})],history=picks(3,['a','b','c']);
  assert.deepEqual(ids(regularOrder(players,3,rows,history)),['b','c','a']);
  assert.deepEqual(ids(historicalRegularOrder(players,3,rows,history)),['a','b','c']);
  assert.deepEqual(ids(historicalRegularOrder(players,1,rows,picks(1,['c','b','a']))),['a','b','c']);
});

function database() {
  const data={settings:[{id:1,current_season:2026,current_week:3,phase:'regular',regular_finalized_at:null,revision:0,playoff_reminders_enabled:false}],
    users:players,season_participants:players.map(p=>({season:2026,user_id:p.id,initial_order:p.initial_order,confirmed:true})),
    weekly_scores:[...scores(1,{a:10,b:2,c:5}),...scores(2,{a:0,b:0,c:0})].map(r=>({...r,season:2026})),qb_picks:[]};
  const queries=[];
  const client={from(table) {
    const filters=[];let single=false;queries.push(table);
    const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},single(){single=true;return q;},then(resolve,reject){
      const output=(data[table]||[]).filter(r=>filters.every(f=>f(r)));
      return Promise.resolve({data:single?output[0]:output,error:data.errorTable===table?{message:'read failed'}:null}).then(resolve,reject);
    }};return q;
  }};
  return {data,queries,client:regularClient(client,{season:2026})};
}

test('loader uses the pinned season, all previous scores, participants and historical picks',async()=>{
  const db=database();db.data.weekly_scores.push(...scores(1,{a:-100,b:100,c:0}).map(r=>({...r,season:2027})));
  assert.deepEqual(ids(await loadRegularOrder(db.client,3)),['b','c','a']);
  const first=database();assert.deepEqual(ids(await loadRegularOrder(first.client,1)),['a','b','c']);
  assert.equal(first.queries.includes('weekly_scores'),false);
});

test('submission permission re-reads the current player and rejects a stale displayed turn',async()=>{
  const db=database();
  await assert.rejects(assertRegularTurn(db.client,3,'a'),/pas encore ton tour/);
  await assertRegularTurn(db.client,3,'b');
  db.data.qb_picks.push({season:2026,week:3,user_id:'b'});
  await assert.rejects(assertRegularTurn(db.client,3,'b'),/déjà soumis/);
  await assertRegularTurn(db.client,3,'c');
  db.data.settings[0].current_week=4;
  await assert.rejects(assertRegularTurn(db.client,3,'c'),/semaine a changé/);
});

test('read failures and invalid weeks never grant submission permission',async()=>{
  for (const table of ['users','weekly_scores','qb_picks','settings']) {
    const db=database();db.data.errorTable=table;
    await assert.rejects(assertRegularTurn(db.client,3,'b'),error=>error.message==='read failed');
  }
  for (const week of [0,-1,1.5,NaN]) assert.throws(()=>regularOrder(players,week),/Semaine/);
});

test('Mes choix uses the shared queue and revalidates before reserving the QB',async()=>{
  const source=await readFile(new URL('../../app/matchs/RegularPage.js',import.meta.url),'utf8');
  assert.match(source,/loadRegularOrder\(supabase, week, players\)/);
  assert.match(source,/remainingSelectionOrder\(fullOrder, currentWeekQbPicks/);
  const submit=source.slice(source.indexOf('  const submitEverything ='));
  assert.ok(submit.indexOf('await assertRegularTurn(supabase, currentWeek, user.id)')<submit.indexOf('.insert({'));
  assert.doesNotMatch(source,/scoreByUser|getWeeklyScoreValue/);
});

test('the real Mes choix submit handler refuses an out-of-turn reservation before any write',async()=>{
  const source=await readFile(new URL('../../app/matchs/RegularPage.js',import.meta.url),'utf8');
  const start=source.indexOf('  const submitEverything ='),end=source.indexOf('\n  const gamesToPick =',start);
  assert.ok(start>=0 && end>start);
  const messages=[],db=database(),bindings={
    supabase:db.client,user:{id:'a'},setMessage:value=>messages.push(value),
    setRegularWritesPaused:()=>{},games:[],savedPicks:{},draftPicks:{},
    existingQbPick:null,selectedQbId:'selected',currentWeek:3,
    window:{confirm:()=>true},assertRegularTurn,
  };
  // The mock has no insert/upsert: reaching a write makes this test fail.
  const submit=new Function(...Object.keys(bindings),source.slice(start,end)+';return submitEverything;')(...Object.values(bindings));
  await submit();
  assert.equal(messages.length,1);assert.match(messages[0],/pas encore ton tour/);
});
