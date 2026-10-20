import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {qbHistory} from './qbHistory.mjs';
import {rankBadges} from './rankBadges.mjs';
const qbs=[{id:'a',name:'Aaron',espn_athlete_id:'1'},{id:'z',name:'Zach',espn_athlete_id:'2'}];
const picks=[{qb_id:'a',week:3,selected_qb_name:'Aaron',selected_espn_athlete_id:'1',selected_team:'Team A'},{qb_id:'z',week:1,selected_qb_name:'Zach',selected_espn_athlete_id:'2',selected_team:'Team Z'}];
test('history follows weeks, preserves official values and never sorts by name',()=>{
 const rows=qbHistory(picks,[{qb_id:'z',week:1,passer_rating:118.4},{qb_id:'z',week:3,passer_rating:50}],qbs);
 assert.deepEqual(rows.map(r=>r.name),['Zach','Aaron']);assert.equal(rows[0].rating,118.4);assert.deepEqual(rows[0].details,['Semaine 1','Passer Rating final : 118.4']);assert.equal(rows[1].rating,null);
 assert.deepEqual(picks.map(p=>p.week),[3,1]);
});
for(const rating of [undefined,null,'',NaN])test(`pending rating is never fabricated: ${rating}`,()=>{
 const row=qbHistory([picks[0]],[{qb_id:'a',week:3,passer_rating:rating}],qbs)[0];assert.equal(row.rating,null);assert.match(row.details.at(-1),/en attente/);
});
test('official zero remains zero',()=>assert.equal(qbHistory([picks[0]],[{qb_id:'a',week:3,passer_rating:0}],qbs)[0].details.at(-1),'Passer Rating final : 0.0'));
test('replacement remains a historical selection with actual QB and official rating',()=>{
 const row=qbHistory([picks[0]],[{qb_id:'a',week:3,actual_espn_athlete_id:'9',actual_qb_name:'Backup',passer_rating:104.7}],qbs)[0];
 assert.equal(row.replaced,true);assert.equal(row.name,'Aaron');assert.equal(row.rating,104.7);assert.ok(row.details.includes('Sélection : Aaron'));assert.ok(row.details.includes('Remplacement : Backup'));assert.match(row.details.join(' '),/aucun des deux QB n’est consommé/);
});
test('same athlete, missing identity, repeated QB and absent catalog remain truthful',()=>{
 assert.equal(qbHistory([picks[0]],[{qb_id:'a',week:3,actual_espn_athlete_id:1}],qbs)[0].replaced,false);
 assert.equal(qbHistory([picks[0]],[{qb_id:'a',week:3,actual_qb_name:'Unknown'}],qbs)[0].replaced,false);
 const rows=qbHistory([{...picks[0],qbs:qbs[0]},{...picks[0],week:4,qbs:qbs[0]}],[],[]);assert.equal(rows.length,2);assert.notEqual(rows[0].historyKey,rows[1].historyKey);
});
const standings=ranks=>Object.fromEntries(ranks.map((rank,i)=>[i+1,rank==null?[]:[{userId:'u',rank}]]));
for(const [ranks,expected] of [[[1,2,3],['🔥 En feu']],[[4,8,13],['🧊 Glacé']],[[1,4,2],[]],[[1,2],[]],[[null,4,5],['🧊 Glacé']]])test('existing badge conditions '+JSON.stringify(ranks),()=>{
 const result=rankBadges(standings(ranks),'u',3,0,4,4);assert.deepEqual(result.badges,expected);
 if(expected.length)assert.equal(result.badgeDetails[expected[0]].length,4);
 if(ranks.includes(null))assert.match(result.badgeDetails['🧊 Glacé'].join(' '),/absent du classement/);
});
test('fall threshold, multiple badges, ordering and exact explanation',()=>{
 assert.deepEqual(rankBadges({},'u',4,-2,2,4).badges,[]);
 const r=rankBadges(standings([6,5,7]),'u',4,-3,2,5);
 assert.deepEqual(r.badges,['🧊 Glacé','📉 Chute libre']);assert.deepEqual(r.badgeDetails['📉 Chute libre'],['Recul de 3 places au classement cumulatif.','Avant la semaine 4 : rang 2','Classement actuel : rang 5']);
 assert.deepEqual(rankBadges(standings([1,2,3]),'u',4,-3,1,4).badges,['🔥 En feu','📉 Chute libre']);
});
test('three latest available weeks, excluding future weeks',()=>{
 const r=rankBadges({1:[{userId:'u',rank:1}],3:[{userId:'u',rank:4}],5:[{userId:'u',rank:5}],7:[{userId:'u',rank:6}],8:[{userId:'u',rank:1}]},'u',7,0,4,4);
 assert.deepEqual(r.badges,['🧊 Glacé']);assert.deepEqual(r.badgeDetails['🧊 Glacé'].slice(1),['Semaine 3 : rang 4','Semaine 5 : rang 5','Semaine 7 : rang 6']);
});
const require=createRequire(import.meta.url),React=require('react'),swc=require('next/dist/build/swc');
async function fixture(width){
 let si=0,ri=0,ei=0;const states=[],refs=[],effects=[],listeners={};
 const react={...React,useId:()=> 'history-test',useRef:v=>refs[ri++] ||= {current:v},useState:v=>{const n=si++;if(!(n in states))states[n]=v;return [states[n],v=>states[n]=v];},useEffect:(f,deps)=>{const n=ei++;const old=effects[n];if(!old||deps.some((d,i)=>d!==old.deps[i])){old?.cleanup?.();effects[n]={deps,cleanup:f()};}}};
 const source=await readFile(new URL('../../app/components/HistoryBadge.js',import.meta.url),'utf8');
 const {code}=await swc.transform(source,{filename:'badge.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
 const exports={};new Function('require','exports',code)(id=>id==='react'?react:id==='react-dom'?{createPortal:(node,body)=>({node,body})}:id.endsWith('.css')?{}:require(id),exports);
 const add=(k,f)=>listeners[k]=f,remove=k=>delete listeners[k];
 global.window={innerWidth:width,innerHeight:800,addEventListener:add,removeEventListener:remove};global.document={body:{},addEventListener:add,removeEventListener:remove};
 const render=()=>{si=ri=ei=0;return exports.default({children:'QB',details:['Semaine 3','Passer Rating final : 104.7'],label:'QB, semaine 3'}).props.children;};
 let tree=render();refs[0].current={getBoundingClientRect:()=>({left:width-70,top:650,bottom:680}),contains:t=>t==='button'};refs[1].current={contains:t=>t==='popup'};
 return {render,listeners,button:()=>render()[0],popup:()=>render()[1],destroy:()=>{effects.forEach(e=>e.cleanup?.());delete global.window;delete global.document;}};
}
for(const width of [1440,390,320])test(`badge interaction and portal bounds ${width}px`,async()=>{
 const f=await fixture(width);
 try {
  assert.equal(f.button().props['aria-expanded'],false);
  f.button().props.onPointerEnter({pointerType:'mouse'});let p=f.popup();assert.equal(p.body,document.body);assert.equal(p.node.props.role,'tooltip');assert.ok(p.node.props.style.left>=12);assert.ok(p.node.props.style.left+p.node.props.style.width<=width-12);
  f.listeners.keydown({key:'Escape'});assert.equal(f.popup(),null);
  f.button().props.onFocus();assert.equal(f.button().props['aria-expanded'],true);f.button().props.onBlur();assert.equal(f.popup(),null);
  f.button().props.onPointerEnter({pointerType:'touch'});assert.equal(f.popup(),null);
  f.button().props.onFocus();f.button().props.onClick();assert.ok(f.popup());f.button().props.onClick();assert.equal(f.popup(),null);
  f.button().props.onClick();f.render();f.listeners.pointerdown({target:'popup'});assert.ok(f.popup());f.listeners.pointerdown({target:'outside'});assert.equal(f.popup(),null);
  f.button().props.onClick();f.render();f.listeners.resize();assert.equal(f.popup(),null);
  f.button().props.onClick();f.render();f.listeners.scroll({target:'page'});assert.equal(f.popup(),null);
 } finally {f.destroy();}
});
