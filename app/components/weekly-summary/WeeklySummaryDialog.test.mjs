import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as presentation from './presentation.mjs';

const require=createRequire(import.meta.url),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'),swc=require('next/dist/build/swc');
const source=await readFile(new URL('./WeeklySummaryDialog.js',import.meta.url),'utf8');
const css=await readFile(new URL('./WeeklySummaryDialog.module.css',import.meta.url),'utf8');
const {code}=await swc.transform(source,{filename:'WeeklySummaryDialog.jsx',jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const styles=Object.fromEntries([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(match=>[match[1],match[1]]));
function component(react=React,document) {
  const exports={};
  new Function('require','exports','document',code)(id=>id.endsWith('.css')?styles:id==='./presentation.mjs'?presentation:id==='react'?react:require(id),exports,document);
  return exports.default;
}
const Dialog=component();
const summary={
  season:2026,week:5,nextWeek:6,
  score:{points:4.512,rank:2,participants:13},
  qb:{selected:{name:'Sam Darnold',team:'Seattle Seahawks',espn_athlete_id:'123'},actual:{name:'Sam Darnold',team:'Seattle Seahawks',espn_athlete_id:'123'},replaced:false,rating:112.8,rank:3,count:13},
  overall:{rank:4,previousRank:6,movement:2,total:31.234},
  teams:[{name:'Buffalo Bills',espn_abbr:'BUF'},{name:'New York Jets',espn_abbr:'NYJ'},{name:'Seattle Seahawks',espn_abbr:'SEA'}],
  games:[0,1,2].map((points,index)=>({id:index,away_team:'Buffalo Bills',home_team:'New York Jets',away_score:27,home_score:20,picked_team:'Buffalo Bills',predicted_spread:7,points,resultText:'Buffalo Bills par 7'})),
};
const render=(data=summary,props={})=>renderToStaticMarkup(React.createElement(Dialog,{summary:data,onClose(){},...props}));

test('the summary is absent until supplied and exposes a labeled native dialog',()=>{
  assert.equal(render(null),'');
  const html=render();
  assert.match(html,/<dialog[^>]+aria-labelledby="[^"]+"[^>]+aria-describedby="[^"]+"[^>]+aria-modal="true"/);
  assert.match(html,/Ta semaine 5, en résumé/);
  assert.match(html,/SAISON 2026/);
  assert.match(html,/Continuer vers la semaine 6/);
  assert.match(html,/aria-label="Fermer le résumé de la semaine"/);
  assert.doesNotMatch(html,/<dialog[^>]+ open/);
});

test('the three tiles render supplied official score, rating, ranks and overall movement',()=>{
  const html=render();
  assert.match(html,/4,512/);assert.match(html,/112,8/);assert.match(html,/31,234/);
  assert.equal((html.match(/class="tile /g)||[]).length,3);
  assert.match(html,/▲ \+2/);assert.doesNotMatch(html,/auparavant/);
  assert.match(css,/\.scoreMain\s*\{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 12px;[^}]*min-width: 0/);
  assert.match(css,/\.scoreIcon\s*\{[^}]*width: 36px; height: 44px/);
  assert.match(css,/\.scoreValue\s*\{[^}]*font-size: clamp\(32px, 3vw, 40px\)/);
  assert.match(html,/QB utilisés/);assert.match(html,/cette semaine/);
  assert.doesNotMatch(html,/Remplacement|Choix initial|undefined|NaN/);
});

test('overall movement distinguishes gained, lost and unchanged ranks',()=>{
  const gained=render();
  assert.match(gained,/class="movementUp"/);assert.match(gained,/aria-label="2 places gagnées"/);
  assert.doesNotMatch(gained,/auparavant/);
  const lost=render({...summary,overall:{...summary.overall,rank:8,previousRank:6,movement:-2}});
  assert.match(lost,/class="movementDown"/);assert.match(lost,/▼ −2/);assert.match(lost,/aria-label="2 places perdues"/);
  assert.doesNotMatch(lost,/auparavant/);
  const unchanged=render({...summary,overall:{...summary.overall,movement:0}});
  assert.match(unchanged,/Position inchangée/);assert.doesNotMatch(unchanged,/▲|▼/);
});

test('the actual replacement and its headshot are shown while preserving the initial choice',()=>{
  const html=render({...summary,qb:{...summary.qb,replaced:true,actual:{name:'Cooper Rush',team:'Seattle Seahawks',espn_athlete_id:'456'}}});
  assert.match(html,/Cooper Rush/);assert.match(html,/players\/full\/456\.png/);
  assert.doesNotMatch(html,/players\/full\/123\.png/);
  assert.match(html,/🔄 Remplacement/);assert.match(html,/Choix initial : Sam Darnold/);
  assert.match(html,/class="replacementBadge"/);
});

test('points use the Mes choix neutral pill and result dots follow the supplied points',()=>{
  const html=render({...summary,games:summary.games.map((game,index)=>({...game,exceptionalNote:index===0?'Match déclaré nul':undefined}))});
  for(const [dot,label] of [['🔴','0 point'],['🟡','1 point'],['🟢','2 points']]) {
    assert.ok(html.includes(`class="points">${label}</span><span class="resultDot" aria-hidden="true">${dot}</span></div></div></li>`));
  }
  assert.match(html,/Match déclaré nul/);
  assert.equal((html.match(/class="gameRow"/g)||[]).length,3);
  assert.match(html,/Buffalo Bills par 7/);
  assert.doesNotMatch(html,/class="points (?:red|yellow|green)"/);
  const unknown=render({...summary,games:[{...summary.games[0],points:null}]});
  assert.match(unknown,/class="points">—<\/span><span class="resultDot" aria-hidden="true">⚪<\/span>/);
  assert.match(css,/\.points\s*\{[^}]*padding: 4px 8px;[^}]*border-radius: 999px;[^}]*background: rgba\(148, 163, 184, \.10\);[^}]*color: #f8fafc/);
});

test('desktop matchups share a centered away-at-home axis while mobile keeps teams facing each other',()=>{
  const html=render({...summary,games:[summary.games[0]]});
  const matchup=html.slice(html.indexOf('<div class="matchup"'),html.indexOf('<div class="pickResult"'));
  assert.match(matchup,/class="teamLine"[\s\S]*class="teamName">Buffalo Bills<\/span><\/div><strong class="teamScore">27<\/strong><span class="at" aria-label="chez">@<\/span><strong class="teamScore">20<\/strong><div class="teamLine"[\s\S]*class="teamName">New York Jets<\/span>/);
  assert.match(matchup,/teamlogos\/nfl\/500\/buf\.png/);assert.match(matchup,/teamlogos\/nfl\/500\/nyj\.png/);
  const desktopCss=css.slice(0,css.indexOf('@media'));
  const mobileCss=css.slice(css.indexOf('@media (max-width: 740px)'),css.indexOf('@media (max-width: 420px)'));
  assert.match(desktopCss,/\.matchup\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) 3ch auto 3ch minmax\(0, 1fr\);[^}]*gap: 8px/);
  assert.match(desktopCss,/\.teamLine\s*\{[^}]*justify-content: flex-end/);
  assert.match(desktopCss,/\.teamLine:last-child\s*\{[^}]*flex-direction: row-reverse/);
  assert.match(desktopCss,/\.teamScore\s*\{[^}]*flex-shrink: 0/);
  assert.match(desktopCss,/\.at\s*\{[^}]*flex-shrink: 0/);
  assert.match(mobileCss,/\.matchup\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto auto minmax\(0, 1fr\)/);
  assert.match(mobileCss,/\.teamLine, \.teamLine:last-child\s*\{[^}]*flex-direction: column;[^}]*justify-content: flex-start/);
  assert.match(html,/<div class="pickResult"><p class="gamePick"><span class="detailLabel">Ton choix<\/span>Buffalo Bills par 7<\/p><div class="resultGroup"><div class="gameResult"><span class="detailLabel">Résultat<\/span>Buffalo Bills par 7/);
});

test('exceptional game notes are shown only when supplied with that game',()=>{
  assert.doesNotMatch(render(),/class="exceptionalNote"|Match déclaré nul/);
  const html=render({...summary,games:[{...summary.games[0],exceptionalNote:'Match déclaré nul'}]});
  assert.equal((html.match(/class="exceptionalNote"/g)||[]).length,1);
  assert.match(html,/Match déclaré nul/);
});

test('compact weeks retain every supplied match and result without changing composition by match count',()=>{
  for(const count of [4,5,6,7]) {
    const games=Array.from({length:count},(_,index)=>({
      ...summary.games[index%summary.games.length],id:`week-game-${index}`,
      away_team:`Équipe extérieure ${index}`,home_team:`Équipe domicile ${index}`,
      away_score:20+index,home_score:10+index,picked_team:`Équipe extérieure ${index}`,
      predicted_spread:index+1,resultText:`Résultat officiel ${index}`,
      exceptionalNote:index===count-1?'Décision officielle conservée':undefined,
    }));
    const html=render({...summary,games});
    assert.equal((html.match(/class="gameRow"/g)||[]).length,count);
    assert.equal((html.match(/class="tile /g)||[]).length,3);
    assert.match(html,new RegExp(`>${count} matchs<`));
    for(const [index,game] of games.entries()) {
      assert.ok(html.includes(`<span class="teamName">${game.away_team}</span>`));
      assert.ok(html.includes(`<span class="teamName">${game.home_team}</span>`));
      assert.ok(html.includes(`<strong class="teamScore">${game.away_score}</strong>`));
      assert.ok(html.includes(`<strong class="teamScore">${game.home_score}</strong>`));
      assert.ok(html.includes(`${game.picked_team} par ${game.predicted_spread}`));
      assert.ok(html.includes(`Résultat officiel ${index}`));
    }
    assert.equal((html.match(/class="points"/g)||[]).length,count);
    assert.equal((html.match(/class="resultDot"/g)||[]).length,count);
    assert.match(html,/Décision officielle conservée/);
    assert.match(html,/Ta semaine 5, en résumé/);
    assert.match(html,/Continuer vers la semaine 6/);
  }
});

test('zero values are retained and missing values never become invented points or ranks',()=>{
  const zero=render({...summary,score:{points:0,rank:1,participants:13},qb:{...summary.qb,rating:0},overall:{rank:1,previousRank:1,movement:0,total:0}});
  assert.match(zero,/class="scoreValue">0 /);assert.match(zero,/1er/);assert.match(zero,/Position inchangée/);
  assert.match(zero,/color:#ef4444">0/);
  const unknown=render({...summary,score:{},qb:{},overall:{},games:[]});
  assert.match(unknown,/QB non identifié/);assert.match(unknown,/Évolution non disponible/);
  assert.match(unknown,/Aucun choix de match/);assert.doesNotMatch(unknown,/undefined|NaN|▲|▼/);
});

test('busy and failure states remain accessible without hiding the results',()=>{
  const html=render(summary,{busy:true,error:'Réessaie <script>ici</script>'});
  assert.match(html,/aria-busy="true"/);assert.match(html,/Enregistrement…/);
  assert.equal((html.match(/disabled=""/g)||[]).length,2);
  assert.match(html,/role="alert"/);assert.match(html,/&lt;script&gt;/);
  assert.match(html,/Tes choix de matchs/);
});

function lifecycleHarness(busy=false) {
  const effects=[],events=[];
  const dialog={open:false,showModal(){this.open=true;events.push('show');},close(){this.open=false;events.push('close');}};
  const close={focus(options){events.push(['initialFocus',options]);}};
  const previous={isConnected:true,focus(options){events.push(['restoreFocus',options]);}};
  const document={activeElement:previous,body:{style:{overflow:'auto'}}};
  const refs=[{current:dialog},{current:close}];let refIndex=0,id=0;
  const react={...React,useRef(){return refs[refIndex++];},useId(){return `summary-${id++}`;},useEffect(effect){effects.push(effect);}};
  let closed=0;
  const element=component(react,document)({summary,onClose(){closed++;},busy});
  return {effects,events,dialog,document,element,get closed(){return closed;}};
}
function descendants(element) {
  if (!element || typeof element!=='object') return [];
  return [element,...React.Children.toArray(element.props?.children).flatMap(descendants)];
}

test('opening traps focus with the native modal and cleanup restores the previous focus and scroll',()=>{
  const h=lifecycleHarness();
  const cleanup=h.effects[0]();
  assert.equal(h.dialog.open,true);assert.equal(h.document.body.style.overflow,'hidden');
  assert.deepEqual(h.events,['show',['initialFocus',{preventScroll:true}]]);
  cleanup();
  assert.equal(h.dialog.open,false);assert.equal(h.document.body.style.overflow,'auto');
  assert.deepEqual(h.events.slice(2),['close',['restoreFocus',{preventScroll:true}]]);
});

test('Escape, the close button and the continue button use the same dismissal callback',()=>{
  const h=lifecycleHarness();let prevented=false;
  h.element.props.onCancel({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.closed,1);
  for(const button of descendants(h.element).filter(node=>node.type==='button')) button.props.onClick();
  assert.equal(h.closed,3);
  const busy=lifecycleHarness(true);
  busy.element.props.onCancel({preventDefault(){}});
  for(const button of descendants(busy.element).filter(node=>node.type==='button')) button.props.onClick();
  assert.equal(busy.closed,0);
});

test('shared presentation uses existing visual conventions without awarding results',()=>{
  assert.equal(presentation.getQbHeadshot(null),null);
  assert.equal(presentation.getQbHeadshot({espn_athlete_id:'789'}),'https://a.espncdn.com/i/headshots/nfl/players/full/789.png');
  assert.deepEqual([100,90,70,69].map(presentation.ratingColor),['#22c55e','#f8fafc','#f97316','#ef4444']);
  assert.equal(presentation.officialResultText({home_score:null,away_score:7}),null);
  assert.equal(presentation.officialResultText({home_score:7,away_score:7}),'Égalité');
  assert.equal(presentation.officialResultText({home_team:'A',away_team:'B',home_score:'14',away_score:'7'}),'A par 7');
  assert.equal(presentation.teamLogoUrl(' buffalo bills ',summary.teams),'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png');
  assert.equal(presentation.teamLogoUrl('Unknown',summary.teams),null);
  assert.deepEqual(presentation.pointsPresentation(null),{label:'—',tone:'neutral'});
});

test('the bounded dialog scrolls its body and changes composition for narrow screens',()=>{
  assert.match(css,/\.shell\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*max-height:/);
  assert.match(css,/\.body\s*\{[^}]*min-height: 0;[^}]*overflow: auto/);
  assert.match(css,/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css,/@media \(max-width: 740px\)[\s\S]*\.tiles \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css,/@media \(max-width: 740px\)[\s\S]*\.gameRow, \.gameRow \+ \.gameRow \{ display: block/);
  assert.match(css,/@media \(max-width: 420px\)[\s\S]*\.resultGroup \{ grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css,/@media \(max-width: 420px\)[\s\S]*\.gameResult \{ grid-column: 1 \/ -1/);
  assert.match(css,/@media \(max-width: 420px\)[\s\S]*\.resultDot \{ grid-column: 2/);
  assert.match(css,/\.closeButton:focus-visible, \.continueButton:focus-visible/);
  assert.doesNotMatch(source,/\bfetch\s*\(|supabase|localStorage|sessionStorage|\.from\(/);
});
