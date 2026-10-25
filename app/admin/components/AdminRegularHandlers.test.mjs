import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectionSnapshot} from '../../../lib/seasons/qbSnapshot.mjs';
import {regularGameResult} from '../../../lib/seasons/regularResults.mjs';

const page=await readFile(new URL('../page.js',import.meta.url),'utf8');
function between(start,end){const a=page.indexOf(start),b=page.indexOf(end,a);assert.ok(a>=0&&b>a);return page.slice(a,b);}
const finalStateSource=between('function espnCompetitionState(summary) {','/* =========================================================\n   ORDRE OFFICIEL');
const sources={
  scores:between('  async function updateScoresFromEspn(currentWeek) {','  /* =========================================================\n     CLASSEMENTS / FICHES'),
  teams:between('  async function updateTeamStandingsFromEspn() {','  /* =========================================================\n     QB RATINGS ESPN'),
  qb:between('  async function updateQBRatingsFromEspn(currentWeek) {','/* =========================================================\n   STATS HEBDOMADAIRES'),
  qbStats:between('async function updateAllQBWeeklyStatsFromEspn(currentWeek) {','  /* =========================================================\n     CALCUL DES SCORES DU POOL'),
  rankings:between('  async function calculateScores(currentWeek,','  /* =========================================================\n     MISE À JOUR COMPLÈTE'),
  nextWeek:between('const nextWeek = async () => {','/* =========================================================\n   RESET MOT DE PASSE UTILISATEUR'),
};
const names={scores:'updateScoresFromEspn',teams:'updateTeamStandingsFromEspn',qb:'updateQBRatingsFromEspn',qbStats:'updateAllQBWeeklyStatsFromEspn',rankings:'calculateScores',nextWeek:'nextWeek'};
function handler(key,bindings){return new Function(...Object.keys(bindings),finalStateSource+sources[key]+`;return ${names[key]};`)(...Object.values(bindings));}
function database(run){
  const calls=[];
  return {calls,from(table){
    const request={table,verb:null,filters:[]};
    const query={
      select(columns){request.columns=columns;if(!request.verb)request.verb='select';return this;},
      eq(key,value){request.filters.push(['eq',key,value]);return this;},
      ilike(key,value){request.filters.push(['ilike',key,value]);return this;},
      update(values){request.verb='update';request.values=values;return this;},
      upsert(values,options){request.verb='upsert';request.values=values;request.options=options;return this;},
      insert(values){request.verb='insert';request.values=values;return this;},
      maybeSingle(){return this;},
      then(resolve,reject){calls.push(request);return Promise.resolve().then(()=>run(request)).then(resolve,reject);},
    };return query;
  }};
}
const game=(id,extras={})=>({id,week:7,home_team:'Bills',away_team:'Jets',external_game_id:String(id),home_score:null,away_score:null,is_pool_eligible:true,...extras});
const finalSummary=(extras={})=>({header:{competitions:[{status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},competitors:[{homeAway:'home',score:'20'},{homeAway:'away',score:'20'}]}]},...extras});
const pendingSummary=state=>({header:{competitions:[{status:{type:{state,completed:false,name:state==='pre'?'STATUS_SCHEDULED':'STATUS_IN_PROGRESS'}},competitors:[{homeAway:'home',score:'0'},{homeAway:'away',score:'0'}]}]}});
const response=(summary,extras={})=>({ok:true,status:200,json:async()=>summary,...extras});
const selected={week:7,qb_id:'selected-qb',selected_qb_name:'Selected QB',selected_espn_athlete_id:'100',selected_team:'Bills',qbs:{id:'overwritten-qb',name:'Current QB',team:'Other team',espn_athlete_id:'999'}};
const teamBox=(name,id='100',rating='100.3')=>({team:{shortDisplayName:name,abbreviation:name==='Bills'?'BUF':'NYJ'},statistics:[{name:'passing',labels:['RTG'],athletes:[{athlete:{id,displayName:`${name} QB`},stats:[rating]}]}]});
const qbSummary=(extras={})=>finalSummary({boxscore:{players:[teamBox('Bills'),teamBox('Jets','200')]},...extras});
const silentConsole={error(){},log(){}};

test('real score importer ignores pre/in placeholders, writes only proved final scores and marks ties final',async()=>{
  const games=[game(1),game(2),game(3),game(4,{is_pool_eligible:false})],writes=[];
  const db=database(q=>{if(q.verb==='select')return {data:games};writes.push(q);return {error:null};});
  const summaries=[pendingSummary('pre'),pendingSummary('in'),finalSummary(),finalSummary()];
  const run=handler('scores',{supabase:db,regularGameResult,fetch:async()=>response(summaries.shift())});
  const result=await run(7);
  assert.equal(result.updated,1);assert.equal(result.pending,2);assert.equal(result.changedGames.length,1);assert.deepEqual(result.warnings,[]);
  assert.equal(writes.length,2);for(const write of writes)assert.deepEqual(write.values,{home_score:20,away_score:20,result_status:'final'});
  assert.equal(db.calls[0].filters.some(([,key])=>key==='is_pool_eligible'),false);
});

test('score importer retains earlier writes and exposes every HTTP, status, payload, JSON and DB failure',async()=>{
  const games=Array.from({length:9},(_,i)=>game(i+1)),updates=[];
  const db=database(q=>q.verb==='select'?{data:games}:(updates.push(q),q.filters[0][2]===9?{error:{message:'denied'}}:{error:null}));
  const missingScore=finalSummary();missingScore.header.competitions[0].competitors[0].score=null;
  const nonterminal=finalSummary();nonterminal.header.competitions[0].status.type.name='STATUS_CANCELED';
  const incomplete=finalSummary();incomplete.header.competitions[0].status.type.completed=false;
  const badScore=finalSummary();badScore.header.competitions[0].competitors[0].score='NaN';
  const summaries=[response(finalSummary()),response(null,{ok:false,status:503}),response(missingScore),response(nonterminal),response(incomplete),response(badScore),response(null,{json:async()=>{throw Error('invalid JSON');}}),response(null,{json:async()=>{throw Error('offline');}}),response(finalSummary())];
  const result=await handler('scores',{supabase:db,regularGameResult,fetch:async()=>summaries.shift()})(7);
  assert.equal(result.updated,1);assert.equal(result.warnings.length,8);assert.equal(result.changedGames.length,1);
  assert.ok(result.warnings.some(w=>w.includes('ESPN 503')));assert.ok(result.warnings.some(w=>w.includes('denied')));
  assert.equal(updates.length,2);
});

test('score and QB initial read failures throw real database messages',async()=>{
  for(const key of ['scores','qb','qbStats']){
    const db=database(()=>({error:{message:'read denied'}}));
    await assert.rejects(handler(key,{supabase:db,regularGameResult,selectionSnapshot,fetch:async()=>{throw Error('must not fetch');}})(7),/read denied/);
  }
});

for(const key of ['qb','qbStats'])test(`${key} treats missing pre/in boxscores as pending and final boxscores as missing data`,async()=>{
  for(const state of ['pre','in','final']){
    const db=database(q=>({data:q.table==='qb_picks'?[selected]:[game(1)]}));
    const summary=state==='final'?finalSummary():pendingSummary(state);
    const result=await handler(key,{supabase:db,selectionSnapshot,fetch:async()=>response(summary)})(7);
    assert.equal(result.updated,0);
    assert.equal(result.notFound.length,state==='final'?1:0);
    assert.equal(result.pending,state==='final'?0:1);
    assert.equal(db.calls.some(q=>q.verb==='upsert'),false);
  }
});

test('selected-QB importer preserves snapshot identity, substitution payloads and counts after a later feed failure',async()=>{
  const games=[game(1)],picks=[selected,{...selected,qb_id:'selected-other',selected_qb_name:'Another selected QB'}];
  let requests=0;
  const db=database(q=>q.verb==='select'?{data:q.table==='qb_picks'?picks:q.table==='games'?games:null}:{error:null});
  const result=await handler('qb',{supabase:db,selectionSnapshot,fetch:async()=>++requests===1?response(qbSummary({boxscore:{players:[teamBox('Bills','replacement','91.2')]}})):response(null,{ok:false,status:502})})(7);
  assert.equal(result.updated,1);assert.equal(result.notFound.length,1);assert.match(result.notFound[0],/Another selected QB.*502/);
  const rating=db.calls.find(q=>q.table==='qb_ratings');
  assert.deepEqual(rating.values,{qb_id:'selected-qb',week:7,passer_rating:91.2,actual_qb_name:'Bills QB',actual_espn_athlete_id:'replacement'});
  assert.equal(db.calls.find(q=>q.table==='qbs'&&q.verb==='insert').values.team,'Bills');
});

test('selected-QB replacement lookup and insertion problems are visible while successfully written ratings stay counted',async()=>{
  for(const failure of ['select','insert']){
    const db=database(q=>{
      if(q.table==='qb_picks')return {data:[selected]};if(q.table==='games')return {data:[game(1)]};
      if(q.table==='qbs'&&q.verb===failure)return {error:{message:'replacement denied'}};
      return {data:null,error:null};
    });
    const result=await handler('qb',{supabase:db,selectionSnapshot,fetch:async()=>response(qbSummary({boxscore:{players:[teamBox('Bills','replacement')]}}))})(7);
    assert.equal(result.updated,1);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/replacement denied/);
  }
});

test('selected-QB importer exposes invalid final ratings and missing historical snapshot identity',async()=>{
  const db=database(q=>({data:q.table==='qb_picks'?[selected,{week:7,qb_id:'legacy',qbs:selected.qbs}]:[game(1)]}));
  const result=await handler('qb',{supabase:db,selectionSnapshot,fetch:async()=>response(qbSummary({boxscore:{players:[teamBox('Bills','100',null)]}}))})(7);
  assert.equal(result.updated,0);assert.equal(result.notFound.length,2);assert.ok(result.notFound.some(w=>w.includes('identité historique')));
});

test('all-QB importer retains successful stat writes and surfaces team lookup, final-stat and later feed failures',async()=>{
  const games=[game(1),game(2)],db=database(q=>{
    if(q.table==='games')return {data:games};
    if(q.table==='teams')return q.filters[0][2]==='BUF'?{error:{message:'team denied'}}:{data:{name:'Jets'}};
    if(q.table==='qb_weekly_stats'&&q.values.espn_athlete_id==='200')return {error:{message:'stat denied'}};
    return {error:null};
  });
  let requests=0;
  const result=await handler('qbStats',{supabase:db,fetch:async()=>++requests===1?response(qbSummary()):response(null,{ok:false,status:503})})(7);
  assert.equal(result.updated,1);assert.equal(result.notFound.length,3);
  for(const phrase of ['team denied','stat denied','503'])assert.ok(result.notFound.some(w=>w.includes(phrase)));
  const written=db.calls.find(q=>q.table==='qb_weekly_stats');
  assert.equal(written.values.passer_rating,100.3);assert.equal(written.values.week,7);assert.equal(written.values.qb_name,'Bills QB');
});

test('all-QB importer reports malformed expected final passing rows instead of writing a zero',async()=>{
  const db=database(q=>q.table==='games'?{data:[game(1)]}:{data:{name:'Bills'}});
  const result=await handler('qbStats',{supabase:db,fetch:async()=>response(qbSummary({boxscore:{players:[teamBox('Bills','100',''),{team:{name:'Jets'},statistics:[]}]}}))})(7);
  assert.equal(result.updated,0);assert.equal(result.notFound.length,2);assert.equal(db.calls.some(q=>q.verb==='upsert'),false);
});

test('standings importer retains earlier counts on later writes and exposes incomplete records',async()=>{
  const entry=(name,stats=true)=>({team:{displayName:name,abbreviation:name},stats:stats?[{name:'wins',value:2},{name:'losses',value:1},{name:'ties',value:0}]:[]});
  const data={children:[{name:'AFC East',standings:{entries:[entry('BUF'),entry('NYJ'),entry('MIA',false)]}}]};
  const db=database(q=>{if(q.filters[0][2]==='NYJ')throw Error('team write offline');return {data:[{id:1}]};});
  const result=await handler('teams',{supabase:db,fetchEspnStandings:async()=>data,console:silentConsole})();
  assert.equal(result.updated,1);assert.equal(result.notMatched.length,2);assert.ok(result.notMatched.some(w=>w.includes('offline')));
  assert.equal(db.calls.length,2);
});

test('standings importer reports an empty final payload and propagates ESPN HTTP errors',async()=>{
  const run=fetchEspnStandings=>handler('teams',{supabase:database(()=>{throw Error('no write');}),fetchEspnStandings,console:silentConsole});
  assert.equal((await run(async()=>({}))()).notMatched.length,1);
  await assert.rejects(run(async()=>{throw Error('ESPN 503');})(),/503/);
});

function authDatabase(token='local-test',error=null){return {auth:{getSession:async()=>({data:{session:token?{access_token:token}:null},error})},from(){throw Error('Client DB mutation forbidden');}};}
const settings={current_season:2026,current_week:7,revision:4};
test('real score publication wrapper uses one authenticated request with season/week/revision and returns actual report',async()=>{
  const requests=[],result={updated:2,publication:{version:3,changed:true},notifications:{sent:1},warnings:[]};
  const run=handler('rankings',{settings,supabase:authDatabase(),fetch:async(...args)=>{requests.push(args);return response(result);}});
  assert.deepEqual(await run(7,settings),result);assert.equal(requests.length,1);
  assert.equal(requests[0][0],'/api/admin/regular-week-results');assert.equal(requests[0][1].headers.Authorization,'Bearer local-test');
  assert.deepEqual(JSON.parse(requests[0][1].body),{season:2026,week:7,revision:4});
});

test('publication wrapper exposes auth, HTTP conflict, and invalid response errors without another write',async()=>{
  for(const [supabase,fetch,pattern] of [
    [authDatabase(null),async()=>{throw Error('must not fetch');},/Session expirée/],
    [authDatabase(),async()=>response({error:'Conflit de semaine'},{ok:false,status:409}),/Conflit de semaine/],
    [authDatabase(),async()=>response(null,{json:async()=>{throw Error('bad json');}}),/pas pu être confirmée/],
  ])await assert.rejects(handler('rankings',{settings,supabase,fetch})(7,settings),pattern);
});

function nextWeekHarness({commit=response({week:8}),notify=response({success:true}),confirmed=true,token='local-test',load=async()=>{},loadStats=async()=>{}}={}){
  const events=[],messages=[],ref={current:false};
  const run=handler('nextWeek',{
    settings,nextWeekRunning:ref,window:{confirm:()=>{events.push(['confirm']);return confirmed;}},supabase:authDatabase(token),
    setMessage:value=>messages.push(value),fetch:async(url,options)=>{events.push([url,options]);return url==='/api/admin/regular-next-week'?await commit:await notify;},
    loadSettings:async()=>{events.push(['settings']);await load();},loadSelectionStats:async week=>{events.push(['stats',week]);await loadStats();},
  });
  return {run,events,messages,ref};
}
test('real next-week handler commits displayed context once, then notifies and reloads',async()=>{
  const h=nextWeekHarness();await h.run();
  assert.deepEqual(h.events.map(e=>e[0]),['confirm','/api/admin/regular-next-week','/api/push/first-player','settings','stats']);
  assert.deepEqual(JSON.parse(h.events[1][1].body),{season:2026,week:7,revision:4,confirm:true});
  assert.equal(h.events[1][1].headers.Authorization,'Bearer local-test');assert.equal(h.events.at(-1)[1],8);
  assert.match(h.messages.at(-1),/Semaine 8 ouverte/);assert.equal(h.ref.current,false);
});

test('next-week conflict never notifies or writes directly; retry keeps the same displayed revision',async()=>{
  const h=nextWeekHarness({commit:response({error:'Conflit 409'},{ok:false,status:409})});await h.run();await h.run();
  assert.match(h.messages.at(-1),/Conflit 409/);assert.equal(h.events.some(e=>e[0]==='/api/push/first-player'),false);
  const requests=h.events.filter(e=>e[0]==='/api/admin/regular-next-week');assert.equal(requests.length,2);assert.equal(requests[0][1].body,requests[1][1].body);
  assert.doesNotMatch(sources.nextWeek,/\.from\(|\.upsert\(|\.update\(/);
});

test('next-week display reload errors report the committed week honestly without repeating the mutation or push',async()=>{
  for(const options of [
    {load:async()=>{throw Error('Settings reload failed');}},
    {loadStats:async()=>{throw Error('Stats reload failed');}},
  ]){
    const h=nextWeekHarness(options);await h.run();
    assert.match(h.messages.at(-1),/^Semaine 8 ouverte\./);
    assert.match(h.messages.at(-1),/actualisation de l’affichage est incomplète/);
    assert.match(h.messages.at(-1),/Recharge la page/);assert.doesNotMatch(h.messages.at(-1),/^Erreur/);
    assert.equal(h.events.filter(e=>e[0]==='/api/admin/regular-next-week').length,1);
    assert.equal(h.events.filter(e=>e[0]==='/api/push/first-player').length,1);
    assert.equal(h.ref.current,false);
  }
});

test('next-week double clicks, cancellation, expired session and postcommit notification errors are handled',async()=>{
  let resolve;const commit=new Promise(r=>{resolve=r;});const h=nextWeekHarness({commit});
  const first=h.run();await new Promise(r=>setImmediate(r));await h.run();assert.equal(h.events.filter(e=>e[0]==='/api/admin/regular-next-week').length,1);
  resolve(response({week:8}));await first;
  const canceled=nextWeekHarness({confirmed:false});await canceled.run();assert.equal(canceled.events.length,1);
  const expired=nextWeekHarness({token:null});await expired.run();assert.match(expired.messages.at(-1),/Session expirée/);assert.equal(expired.events.length,1);
  const failedNotify=nextWeekHarness({notify:response(null,{ok:false,status:503})});await failedNotify.run();
  assert.match(failedNotify.messages.at(-1),/Semaine 8 ouverte/);assert.match(failedNotify.messages.at(-1),/notification/);assert.ok(failedNotify.events.some(e=>e[0]==='settings'));
});
