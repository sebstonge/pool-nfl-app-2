import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {ROUNDS} from './rounds.mjs';
import {snapshotState} from '../../app/admin/playoffs/snapshotAdmin.mjs';
const require=createRequire(import.meta.url),React=require('react'),swc=require('next/dist/build/swc');
function hooks(initial){let i=0;const values=[...initial],ref={current:false};return {values,react:{...React,useEffect:()=>{},useRef:()=>ref,useState:()=>{const n=i++;return [values[n],v=>values[n]=v];}},render(fn){i=0;return fn();}};}
function all(n,p){if(!n||typeof n!=='object')return [];if(Array.isArray(n))return n.flatMap(x=>all(x,p));return [...(p(n)?[n]:[]),...all(n.props?.children,p)];}
async function compile(file,deps){const {code}=await swc.transform(await readFile(new URL(file,import.meta.url),'utf8'),{filename:'ui.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});const exports={};new Function('require','exports',code)(id=>{if(id==='react/jsx-runtime')return require(id);const v=deps(id);return v?.default?{__esModule:true,...v}:v;},exports);return exports;}
async function setup(key,status,{activeMode=true,canAdvance=true,blocked='',request=async()=>{throw Error('Publication périmée');}}={}){
 const definition=ROUNDS.find(r=>r.key===key),data={completeMatchParticipants:13},h=hooks([data,'','',false,null,[]]);
 const view={current:{round_key:key,status},definition,canAdvance,canUpdate:true,blocked,games:[],officialCount:definition.count,finalCount:definition.count};
 function Finish(){};
 const ui=await compile('../../app/admin/playoffs/RoundAdmin.js',id=>id==='react'?h.react:id.includes('rounds.mjs')?{ROUNDS,roundSummary:()=>view}:id.includes('SeasonLifecycle')?{default:Finish}:id.endsWith('.css')?{default:{}}:{});
 return {h,data,Finish,render:()=>h.render(()=>ui.default({season:2099,activeMode,request}))};
}
for(const key of ['wild_card','divisional','conference'])test(key+': scored offers one atomic advance and secondary collapsed update',async()=>{
 const s=await setup(key,'scored'),tree=s.render();
 assert.equal(all(tree,n=>n.type==='button'&&n.props.className==='button').length,1);
 assert.equal(all(tree,n=>n.type==='details')[0].props.open,false);
 const advance=all(tree,n=>n.type==='button'&&n.props.className==='button')[0];advance.props.onClick();
 assert.equal(all(s.render(),n=>typeof n.type==='function')[0].props.action,'advance');
});
for(const status of ['open','locked'])test(status+': only update, no premature transition',async()=>{
 const s=await setup('wild_card',status),buttons=all(s.render(),n=>n.type==='button');assert.equal(buttons.length,1);assert.equal(buttons[0].props.children,'Mise à jour complète');assert.equal(buttons[0].props.disabled,false);
});
test('preparation is performed by regular lifecycle, never separate seed/prepare actions',async()=>{
 const s=await setup('wild_card','draft',{activeMode:false});const buttons=all(s.render(),n=>n.type==='button');assert.equal(buttons.length,1);assert.equal(buttons[0].props.children,'Ouvrir le Wild Card');assert.equal(buttons[0].props.disabled,true);assert.equal(buttons[0].props.onClick,undefined);
});
test('Super Bowl uses existing finish lifecycle, never advance',async()=>{
 const s=await setup('super_bowl','scored'),tree=s.render();assert.equal(all(tree,n=>n.type===s.Finish&&n.props.finish).length,1);assert.equal(all(tree,n=>n.type==='button'&&n.props.className==='button').length,0);
});
test('failed atomic request preserves data; no frontend finalization or opening call',async()=>{
 const calls=[],s=await setup('wild_card','scored',{request:async body=>{calls.push(body);throw Error('Publication périmée');}});
 all(s.render(),n=>n.type==='button'&&n.props.className==='button')[0].props.onClick();
 const dialog=all(s.render(),n=>typeof n.type==='function')[0];await dialog.props.onConfirm();
 assert.deepEqual(calls,[{action:'advance',season:2099,roundKey:'wild_card',confirmed:true}]);assert.equal(s.h.values[0],s.data);assert.match(s.h.values[1],/Publication périmée/);
});
test('TEST/incompatible round preserves blocker and disables advancement',async()=>{
 const s=await setup('wild_card','scored',{canAdvance:false,blocked:'Matchs TEST conservés'}),tree=s.render();assert.equal(all(tree,n=>n.type==='button'&&n.props.className==='button')[0].props.disabled,true);
 assert.equal(all(tree,n=>n.type==='p'&&n.props.children==='Matchs TEST conservés').length,1);
});
for(const activeMode of [false,true])test('seed consultation remains in preview/active mode without technical mutations: '+activeMode,async()=>{
 const h=hooks([[],'']);const ui=await compile('../../app/admin/playoffs/page.js',id=>id==='react'?h.react:id.includes('snapshotAdmin')?{snapshotState}:id.endsWith('.css')?{default:{}}:id.endsWith('RoundAdmin')?{default:()=>null}:id.includes('NotificationLog')?{default:()=>null}:{});
 const tree=h.render(()=>ui.PlayoffsAdminView({season:2099,activeMode,request:()=>assert.fail('unexpected mutation')}));
 assert.equal(all(tree,n=>n.type==='button').length,0);assert.equal(all(tree,n=>n.type==='h2'&&['AFC','NFC'].includes(n.props.children)).length,2);
});

test('preview update is visible but cannot mutate an open TEST round',async()=>{
 const s=await setup('wild_card','open',{activeMode:false,canAdvance:false,blocked:'TEST'});
 const buttons=all(s.render(),n=>n.type==='button');assert.equal(buttons.length,1);assert.equal(buttons[0].props.children,'Mise à jour complète');assert.equal(buttons[0].props.disabled,true);await buttons[0].props.onClick();assert.equal(s.h.values[1],'');
});

for(const key of ['wild_card','divisional','conference','super_bowl'])test('preview scored action disabled: '+key,async()=>{
 const s=await setup(key,'scored',{activeMode:false,request:()=>assert.fail('preview mutation')});
 const button=all(s.render(),n=>n.type==='button'&&n.props.className==='button')[0];assert.ok(button);assert.equal(button.props.disabled,true);
 if(button.props.onClick){button.props.onClick();await all(s.render(),n=>typeof n.type==='function')[0].props.onConfirm();}
});
test('notification UI reveals five at a time, uses human states and hides missing diagnostics',async()=>{
 const rows=Array.from({length:12},(_,i)=>({id:String(i),recipient:'Joueur '+i,type:'Tour du joueur',state:i===0?'accepted':'not_sent',date:'2026-10-08',title:i===0?'Message envoyé':null,reason:i===1?'Erreur utile':null}));
 const h=hooks(['all',0,{rows,telemetryAvailable:true},'',5]);
 const ui=await compile('../../app/admin/components/NotificationLog.js',id=>id==='react'?h.react:id.includes('adminLog')?{STATE_LABELS:{accepted:'Acceptée par le fournisseur',not_sent:'Non envoyée · aucune tentative'},torontoDate:()=> '8 oct. 13:22'}:id.endsWith('.css')?{default:{}}:{});
 const render=()=>h.render(()=>ui.default({}));
 assert.equal(all(render(),n=>n.type==='details').length,5);
 const {renderToStaticMarkup}=require('react-dom/server');
 const summary=renderToStaticMarkup(all(render(),n=>n.type==='summary')[0]);assert.match(summary,/Envoyée/);assert.doesNotMatch(summary,/fournisseur/);
 const html=renderToStaticMarkup(render());assert.doesNotMatch(html,/Non documentée|Heure indisponible|Envoi prévu/);assert.match(html,/Message envoyé/);assert.match(html,/Erreur utile/);
 all(render(),n=>n.type==='button'&&n.props.children==='Voir plus')[0].props.onClick();
 // This harness stores updater functions; apply the functional state update.
 h.values[4]=h.values[4](5);assert.equal(all(render(),n=>n.type==='details').length,10);
 all(render(),n=>n.type==='button'&&n.props.children==='Voir plus')[0].props.onClick();h.values[4]=h.values[4](10);
 assert.equal(all(render(),n=>n.type==='details').length,12);assert.equal(all(render(),n=>n.type==='button'&&n.props.children==='Voir plus').length,0);
});
