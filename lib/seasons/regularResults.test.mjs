import test from 'node:test';
import assert from 'node:assert/strict';
import {regularGameResult,regularPickResult} from './regularResults.mjs';

const game={home_team:'Home',away_team:'Away',home_score:20,away_score:20};
const pick=(picked_team='Home',predicted_spread=3)=>({picked_team,predicted_spread});

test('equal scores, including 0–0, need affirmative final evidence',()=>{
  for(const scores of [[20,20],[0,0]]){
    for(const evidence of [{},{state:'in',completed:true},{state:'post',completed:false},{result_status:'pending'}]){
      const pending={...game,home_score:scores[0],away_score:scores[1],...evidence};
      assert.deepEqual(regularGameResult(pending),{status:'pending',winner:null,spread:null});
      assert.equal(regularPickResult(pending,pick()).points,null);
    }
  }
});

test('each confirmed tie awards one to either valid side and never exact, even legacy zero',()=>{
  for(const evidence of [{result_status:'final'},{state:'post',completed:true},{state:'post',final_status:'STATUS_FINAL'}]){
    for(const team of ['Home','Away'])for(const spread of [0,3]){
      const result=regularPickResult({...game,...evidence},pick(team,spread));
      assert.deepEqual(result,{status:'tie',winner:null,spread:0,points:1,correct:false,exact:false});
    }
  }
  assert.equal(regularPickResult({...game,result_status:'final'},pick('Other',0)).points,null);
});

test('normal win, exact spread and wrong-side rules stay unchanged',()=>{
  const final={...game,result_status:'final',home_score:27};
  assert.deepEqual(regularGameResult(final),{status:'winner',winner:'Home',spread:7});
  assert.deepEqual(['Home','Home','Away'].map((team,i)=>regularPickResult(final,pick(team,i===0?7:3)).points),[2,1,0]);
  assert.equal(regularPickResult(final,pick('Home','7')).exact,true);
  assert.equal(regularPickResult({...final,result_status:null},pick()).points,null);
});

test('invalid final scores stay pending and helpers never mutate their inputs',()=>{
  for(const value of [null,undefined,'',-1,NaN,Infinity,2.5,true]){
    assert.equal(regularGameResult({...game,result_status:'final',home_score:value}).status,'pending');
  }
  const frozenGame=Object.freeze({...game,result_status:'final'}),frozenPick=Object.freeze(pick('Away',0));
  assert.equal(regularPickResult(frozenGame,frozenPick).points,1);
});
